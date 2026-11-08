// The back office of the e-invoicing pack: the seller profile, the EGS units, the onboarding steps and the
// read side of each invoice's ZATCA record. A plain class (built by compliance.module.ts), so an integration
// test can give it a scripted ZATCA transport.
//
// Placement: the business rules live in the compliance pack (packages/compliance/zatca-sa). This class is the
// composition layer in apps/api, the one place allowed to read Company / Party rows and write audit entries
// (the pack has no dependency on @erp/core, docs/02-ARCHITECTURE-RULES.md §1).
//
// What this class NEVER does: return, log or audit key material, a CSID, a secret, an OTP or a decrypted
// anything (docs/09-SECURITY-RULES.md §5). The views below are built field by field, so a new column on
// `egs_credentials` cannot leak into an API response by accident.
import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "@erp/core";
import {
  EgsChainService,
  OnboardingError,
  ZATCA_CSR_CERTIFICATE_TEMPLATE,
  ZatcaApiError,
  buildComplianceSamples,
  type ComplianceSample,
  type OnboardingService,
  type ZatcaEnvironment,
  type ZatcaParty,
} from "@erp/compliance-zatca-sa";

export type ComplianceErrorCode =
  | "SELLER_PROFILE_INCOMPLETE"
  | "SELLER_LOCKED"
  | "EGS_NOT_FOUND"
  | "EGS_DUPLICATE"
  | "WRONG_STATUS"
  | "INVOICE_RECORD_NOT_FOUND"
  | "SUBMISSION_NOT_WIRED"
  | "ENCRYPTION_KEY_MISSING";

export class ComplianceError extends Error {
  constructor(
    readonly code: ComplianceErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ComplianceError";
  }
}

export interface Actor {
  readonly id: string;
  readonly companyId: string;
}

export const SELLER_PROFILE_FIELDS = ["vatNumber", "crNumber", "crNumberScheme", "streetName", "additionalStreetName", "buildingNumber", "additionalNumber", "district", "city", "postalCode", "countryCode", "nameAr"] as const;
export type SellerProfileField = (typeof SELLER_PROFILE_FIELDS)[number];
export type SellerProfileInput = Partial<Record<SellerProfileField, string | null>>;

// What must be present before an EGS can be onboarded: ZATCA validates every one of these on every invoice.
// REVIEW: `additionalStreetName` and `additionalNumber` are optional here; whether the Schematron demands the
// plot/additional number for a seller address was not confirmed (no access to the rules in this session).
const REQUIRED_FOR_ONBOARDING: readonly SellerProfileField[] = ["vatNumber", "crNumber", "crNumberScheme", "streetName", "buildingNumber", "district", "city", "postalCode", "countryCode", "nameAr"];

export interface SellerProfileView {
  readonly name: string;
  readonly nameAr: string | null;
  readonly vatNumber: string | null;
  readonly crNumber: string | null;
  readonly crNumberScheme: string | null;
  readonly streetName: string | null;
  readonly additionalStreetName: string | null;
  readonly buildingNumber: string | null;
  readonly additionalNumber: string | null;
  readonly district: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
  readonly missing: readonly SellerProfileField[];
  readonly complete: boolean;
  // True once any EGS has a certificate issued: the VAT number, registration and address are then bound into it.
  readonly locked: boolean;
}

export type ExpiryState = "OK" | "EXPIRING_SOON" | "EXPIRED";

export interface EgsUnitView {
  readonly id: string;
  readonly name: string;
  readonly serial: string;
  readonly branchName: string | null;
  readonly businessCategory: string;
  readonly invoiceTypes: string;
  readonly environment: ZatcaEnvironment;
  readonly status: string;
  readonly isActive: boolean;
  readonly credentialStatus: string | null;
  readonly certificateExpiresAt: string | null;
  readonly daysUntilExpiry: number | null;
  readonly expiry: ExpiryState | null;
  readonly lastRenewalAt: string | null;
  readonly lastIcv: string;
}

export interface OnboardingStepResult {
  readonly step: "COMPLIANCE_CSID" | "COMPLIANCE_CHECKS" | "PRODUCTION_CSID" | "RENEWAL";
  readonly ok: boolean;
  readonly egsStatus: string;
  // Per-document results for COMPLIANCE_CHECKS.
  readonly checks?: readonly { readonly label: string; readonly ok: boolean; readonly message?: string }[];
  readonly error?: { readonly code: string; readonly message: string; readonly status?: number; readonly body?: unknown };
}

export interface InvoiceRecordView {
  readonly salesInvoiceId: string;
  readonly status: string;
  readonly uuid: string;
  readonly icv: string;
  readonly attempts: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly hasSignedXml: boolean;
  readonly hasClearedXml: boolean;
  readonly qrCode: string | null;
  readonly environment: ZatcaEnvironment;
  readonly submittedAt: string | null;
  readonly clearedAt: string | null;
  readonly reportedAt: string | null;
  // A rejected invoice is never resubmitted (docs/06 §7); only one that has not reached a verdict can be.
  readonly canResubmit: boolean;
}

export interface Resubmitter {
  enqueue(salesInvoiceId: string, egsUnitId: string): Promise<void>;
}

export interface ComplianceAdminOptions {
  readonly defaultEnvironment: ZatcaEnvironment;
  readonly expiryWarningDays?: number;
  readonly now?: () => Date;
  // Not provided today: nothing maps a SalesInvoice into a ZATCA submission yet (see docs/01 section Z).
  readonly resubmitter?: Resubmitter | undefined;
}

const DEFAULT_EXPIRY_WARNING_DAYS = 30;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// ZATCA's error bodies are { errorCode, errorCategory, errorMessage } -- small and safe to hand to the screen --
// but a body is untrusted input, so it is cut down to at most 2 KB of JSON text.
function boundedBody(body: unknown): unknown {
  if (body === undefined || body === null) return undefined;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.length > 2048 ? `${text.slice(0, 2048)}…` : body;
}

export class ComplianceAdminService {
  private readonly now: () => Date;
  private readonly expiryWarningDays: number;
  private readonly chain = new EgsChainService();

  constructor(
    private readonly prisma: PrismaClient,
    // A thunk: the encryption key is only required once a key is actually generated, so the API can start without it.
    private readonly onboarding: () => OnboardingService,
    private readonly audit: IAuditLogger,
    private readonly options: ComplianceAdminOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.expiryWarningDays = options.expiryWarningDays ?? DEFAULT_EXPIRY_WARNING_DAYS;
  }

  // ── overview ────────────────────────────────────────────────────────────────────────────────────────────

  async overview(companyId: string): Promise<{ readonly environment: ZatcaEnvironment; readonly seller: SellerProfileView; readonly egsUnits: readonly EgsUnitView[]; readonly capabilities: { readonly resubmit: boolean } }> {
    return {
      environment: this.options.defaultEnvironment,
      seller: await this.sellerProfile(companyId),
      egsUnits: await this.listEgsUnits(companyId),
      capabilities: { resubmit: this.options.resubmitter !== undefined },
    };
  }

  // ── seller profile ──────────────────────────────────────────────────────────────────────────────────────

  async sellerProfile(companyId: string): Promise<SellerProfileView> {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const issued = await this.prisma.egsCredential.count({ where: { companyId, status: { notIn: ["NEW"] } } });
    const view = {
      name: company.name,
      nameAr: company.nameAr,
      vatNumber: company.vatNumber,
      crNumber: company.crNumber,
      crNumberScheme: company.crNumberScheme,
      streetName: company.streetName,
      additionalStreetName: company.additionalStreetName,
      buildingNumber: company.buildingNumber,
      additionalNumber: company.additionalNumber,
      district: company.district,
      city: company.city,
      postalCode: company.postalCode,
      countryCode: company.countryCode,
    };
    const missing = REQUIRED_FOR_ONBOARDING.filter((f) => !(view[f] ?? "").trim());
    return { ...view, missing, complete: missing.length === 0, locked: issued > 0 };
  }

  async updateSellerProfile(input: SellerProfileInput, actor: Actor, correlationId: string): Promise<SellerProfileView> {
    const before = await this.sellerProfile(actor.companyId);
    // A field counts as "sent" only if it is not `undefined`. Checking `field in input` here is a trap: when
    // `input` is a class-validator DTO instance (built by Nest's ValidationPipe), every `@IsOptional()` property is
    // an own property of the instance -- set to `undefined` -- whether or not the client's JSON body included it,
    // because the API's ES2022 target defines class fields in the constructor (`useDefineForClassFields`). So `in`
    // cannot distinguish "sent as null" from "not sent at all"; only an explicit `!== undefined` check can, which is
    // why the loop below reads `raw` once and skips the field entirely while it is still `undefined`.
    const data: Record<string, string | null> = {};
    for (const field of SELLER_PROFILE_FIELDS) {
      const raw = input[field];
      if (raw === undefined) continue;
      data[field] = raw === null || raw.trim() === "" ? null : raw.trim();
    }
    if (before.locked) {
      // The certificate carries the VAT number, the registration and the address; changing them afterwards would make
      // every new invoice disagree with its own certificate. Reissuing a certificate is a deliberate, separate act.
      const changed = Object.keys(data).filter((f) => data[f] !== (before[f as SellerProfileField] ?? null));
      if (changed.length > 0) throw new ComplianceError("SELLER_LOCKED", "The seller profile is bound into an issued certificate and can no longer be edited here", { fields: changed });
    }
    await this.prisma.company.update({ where: { id: actor.companyId }, data: { ...data, updatedBy: actor.id, version: { increment: 1 } } });
    const after = await this.sellerProfile(actor.companyId);
    await this.audit.log({ actorId: actor.id, action: "compliance.seller_profile_updated", entityType: "Company", entityId: actor.companyId, before: { ...before }, after: { ...after }, correlationId });
    return after;
  }

  // ── EGS units ───────────────────────────────────────────────────────────────────────────────────────────

  async listEgsUnits(companyId: string): Promise<readonly EgsUnitView[]> {
    const rows = await this.prisma.egsUnit.findMany({ where: { companyId }, include: { credential: true, chainState: true }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => this.egsView(r));
  }

  async getEgsUnit(companyId: string, id: string): Promise<EgsUnitView> {
    const row = await this.prisma.egsUnit.findFirst({ where: { id, companyId }, include: { credential: true, chainState: true } });
    if (!row) throw new ComplianceError("EGS_NOT_FOUND", "EGS unit not found");
    return this.egsView(row);
  }

  async createEgsUnit(
    input: { readonly name: string; readonly branchName?: string | undefined; readonly businessCategory: string; readonly invoiceTypes: string },
    actor: Actor,
    correlationId: string,
  ): Promise<EgsUnitView> {
    const id = newId();
    // ZATCA's serial format "1-<solution>|2-<model>|3-<unit serial>"; the unit serial is a fresh UUID so two
    // units can never collide.
    const serial = `1-Markaz|2-ERP-Lite|3-${id}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.egsUnit.create({
        data: { id, companyId: actor.companyId, name: input.name, serial, branchName: input.branchName ?? null, businessCategory: input.businessCategory, invoiceTypes: input.invoiceTypes, environment: this.options.defaultEnvironment, createdBy: actor.id },
      });
      await this.chain.createFor(tx, actor.companyId, id);
    });
    const view = await this.getEgsUnit(actor.companyId, id);
    await this.audit.log({ actorId: actor.id, action: "compliance.egs_created", entityType: "EgsUnit", entityId: id, after: { ...view }, correlationId });
    return view;
  }

  // ── onboarding ──────────────────────────────────────────────────────────────────────────────────────────

  // Step 1: CSR -> compliance CSID. The OTP (from the taxpayer's Fatoora portal) is used once and never stored or logged.
  async startOnboarding(egsUnitId: string, otp: string, actor: Actor, correlationId: string): Promise<OnboardingStepResult> {
    const unit = await this.requireUnit(actor.companyId, egsUnitId);
    const credential = unit.credential;
    if (credential && !["NEW", "COMPLIANCE_CSID_ISSUED"].includes(credential.status)) {
      throw new ComplianceError("WRONG_STATUS", `This EGS unit is already past the first step (status ${credential.status})`);
    }
    const seller = await this.requireCompleteSeller(actor.companyId);
    const environment = unit.environment as ZatcaEnvironment;
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: actor.companyId } });

    try {
      await this.service().startOnboarding({
        companyId: actor.companyId,
        egsUnitId,
        environment,
        otp,
        certificateTemplateName: ZATCA_CSR_CERTIFICATE_TEMPLATE[environment],
        csr: {
          commonName: unit.name,
          organizationUnit: unit.branchName ?? company.name,
          organizationName: company.name,
          countryCode: seller.address.countryCode,
          egsSerial: unit.serial,
          vatNumber: seller.vatNumber ?? "",
          invoiceTypeDigits: unit.invoiceTypes,
          // REVIEW: free text per the Security Standard; the SDK's own sample uses a Short Address ("RRRD2929").
          location: `${seller.address.buildingNumber ?? ""} ${seller.address.streetName}, ${seller.address.citySubdivisionName}, ${seller.address.cityName}`.trim(),
          businessCategory: unit.businessCategory,
        },
      });
    } catch (error) {
      return this.failed("COMPLIANCE_CSID", unit.status, error, actor, egsUnitId, correlationId);
    }
    await this.prisma.egsUnit.update({ where: { id: egsUnitId }, data: { status: "COMPLIANCE_CSID_ISSUED", updatedBy: actor.id, version: { increment: 1 } } });
    await this.audit.log({ actorId: actor.id, action: "compliance.onboarding_csid_issued", entityType: "EgsUnit", entityId: egsUnitId, correlationId });
    return { step: "COMPLIANCE_CSID", ok: true, egsStatus: "COMPLIANCE_CSID_ISSUED" };
  }

  // Step 2: every required sample document must pass. All of them are attempted so the screen can show every
  // failure at once; the unit only advances when all pass.
  async runComplianceChecks(egsUnitId: string, actor: Actor, correlationId: string): Promise<OnboardingStepResult> {
    const unit = await this.requireUnit(actor.companyId, egsUnitId);
    if (unit.credential?.status !== "COMPLIANCE_CSID_ISSUED") throw new ComplianceError("WRONG_STATUS", "Request the compliance certificate (step 1) first");
    const seller = await this.requireCompleteSeller(actor.companyId);
    const environment = unit.environment as ZatcaEnvironment;

    const wanted = (sample: ComplianceSample): boolean => (sample.isSimplified ? unit.invoiceTypes[1] === "1" : unit.invoiceTypes[0] === "1");
    const samples = buildComplianceSamples(seller, this.now(), newId).filter(wanted);
    const checks: { label: string; ok: boolean; message?: string }[] = [];
    for (const sample of samples) {
      try {
        await this.service().runComplianceCheck({ egsUnitId, environment, isSimplified: sample.isSimplified, signingTime: sample.signingTime, qr: sample.qr, sampleInvoice: sample.input });
        checks.push({ label: sample.label, ok: true });
      } catch (error) {
        if (error instanceof OnboardingError && error.code === "WRONG_STATUS") throw new ComplianceError("WRONG_STATUS", error.message);
        checks.push({ label: sample.label, ok: false, message: error instanceof Error ? error.message : "Unknown error" });
      }
    }
    const allPassed = checks.length > 0 && checks.every((c) => c.ok);
    if (allPassed) {
      await this.service().markComplianceChecksPassed(egsUnitId);
      await this.prisma.egsUnit.update({ where: { id: egsUnitId }, data: { status: "COMPLIANCE_CHECKS_PASSED", updatedBy: actor.id, version: { increment: 1 } } });
    }
    await this.audit.log({ actorId: actor.id, action: allPassed ? "compliance.checks_passed" : "compliance.checks_failed", entityType: "EgsUnit", entityId: egsUnitId, after: { checks }, correlationId });
    return { step: "COMPLIANCE_CHECKS", ok: allPassed, egsStatus: allPassed ? "COMPLIANCE_CHECKS_PASSED" : "COMPLIANCE_CSID_ISSUED", checks };
  }

  // Step 3: the production certificate.
  async requestProductionCsid(egsUnitId: string, actor: Actor, correlationId: string): Promise<OnboardingStepResult> {
    const unit = await this.requireUnit(actor.companyId, egsUnitId);
    try {
      await this.service().requestProductionCsid(egsUnitId, unit.environment as ZatcaEnvironment);
    } catch (error) {
      if (error instanceof OnboardingError && error.code === "WRONG_STATUS") throw new ComplianceError("WRONG_STATUS", error.message);
      return this.failed("PRODUCTION_CSID", unit.status, error, actor, egsUnitId, correlationId);
    }
    await this.prisma.egsUnit.update({ where: { id: egsUnitId }, data: { status: "ACTIVE", updatedBy: actor.id, version: { increment: 1 } } });
    await this.audit.log({ actorId: actor.id, action: "compliance.production_csid_issued", entityType: "EgsUnit", entityId: egsUnitId, correlationId });
    return { step: "PRODUCTION_CSID", ok: true, egsStatus: "ACTIVE" };
  }

  // Renewal with a new OTP, reusing the existing key (packages/compliance/zatca-sa onboarding.service.ts).
  async renew(egsUnitId: string, otp: string, actor: Actor, correlationId: string): Promise<OnboardingStepResult> {
    const unit = await this.requireUnit(actor.companyId, egsUnitId);
    if (unit.credential?.status !== "ACTIVE") throw new ComplianceError("WRONG_STATUS", "Only an active EGS unit can be renewed");
    const seller = await this.requireCompleteSeller(actor.companyId);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: actor.companyId } });
    const environment = unit.environment as ZatcaEnvironment;
    try {
      await this.service().renewProductionCsid(egsUnitId, environment, otp, {
        commonName: unit.name,
        organizationUnit: unit.branchName ?? company.name,
        organizationName: company.name,
        countryCode: seller.address.countryCode,
        egsSerial: unit.serial,
        vatNumber: seller.vatNumber ?? "",
        invoiceTypeDigits: unit.invoiceTypes,
        location: `${seller.address.buildingNumber ?? ""} ${seller.address.streetName}, ${seller.address.citySubdivisionName}, ${seller.address.cityName}`.trim(),
        businessCategory: unit.businessCategory,
        certificateTemplateName: ZATCA_CSR_CERTIFICATE_TEMPLATE[environment],
      });
    } catch (error) {
      return this.failed("RENEWAL", unit.status, error, actor, egsUnitId, correlationId);
    }
    await this.audit.log({ actorId: actor.id, action: "compliance.certificate_renewed", entityType: "EgsUnit", entityId: egsUnitId, correlationId });
    return { step: "RENEWAL", ok: true, egsStatus: "ACTIVE" };
  }

  // ── invoices ────────────────────────────────────────────────────────────────────────────────────────────

  async invoiceRecord(companyId: string, salesInvoiceId: string): Promise<InvoiceRecordView | null> {
    const row = await this.prisma.zatcaInvoiceRecord.findFirst({ where: { salesInvoiceId, companyId }, include: { egsUnit: true } });
    if (!row) return null;
    return {
      salesInvoiceId,
      status: row.status,
      uuid: row.uuid,
      icv: row.icv.toString(),
      attempts: row.attempts,
      warnings: asStringArray(row.validationWarnings),
      errors: asStringArray(row.validationErrors),
      hasSignedXml: row.signedXml !== null,
      hasClearedXml: row.clearedXml !== null,
      qrCode: row.qrCode,
      environment: row.egsUnit.environment as ZatcaEnvironment,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      clearedAt: row.clearedAt?.toISOString() ?? null,
      reportedAt: row.reportedAt?.toISOString() ?? null,
      canResubmit: row.status === "FAILED_RETRYABLE" || row.status === "SUBMITTING",
    };
  }

  // Just the status per invoice, for the badges on a list page (one query for the whole page).
  async invoiceStatuses(companyId: string, salesInvoiceIds: readonly string[]): Promise<Record<string, { readonly status: string; readonly environment: ZatcaEnvironment }>> {
    if (salesInvoiceIds.length === 0) return {};
    const rows = await this.prisma.zatcaInvoiceRecord.findMany({ where: { companyId, salesInvoiceId: { in: [...salesInvoiceIds] } }, select: { salesInvoiceId: true, status: true, egsUnit: { select: { environment: true } } } });
    return Object.fromEntries(rows.map((r) => [r.salesInvoiceId, { status: r.status, environment: r.egsUnit.environment as ZatcaEnvironment }]));
  }

  // `cleared` is the version a standard (B2B) buyer must receive; `signed` is what we signed and sent.
  async xml(companyId: string, salesInvoiceId: string, kind: "signed" | "cleared"): Promise<string> {
    const row = await this.prisma.zatcaInvoiceRecord.findFirst({ where: { salesInvoiceId, companyId }, select: { signedXml: true, clearedXml: true } });
    const xml = kind === "cleared" ? row?.clearedXml : row?.signedXml;
    if (!xml) throw new ComplianceError("INVOICE_RECORD_NOT_FOUND", `No ${kind} XML is stored for this invoice`);
    return xml;
  }

  async resubmit(companyId: string, salesInvoiceId: string, actor: Actor, correlationId: string): Promise<InvoiceRecordView> {
    const record = await this.invoiceRecord(companyId, salesInvoiceId);
    if (!record) throw new ComplianceError("INVOICE_RECORD_NOT_FOUND", "This invoice has no ZATCA record");
    if (!record.canResubmit) throw new ComplianceError("WRONG_STATUS", `An invoice with status ${record.status} cannot be resubmitted; a correction is a new document`);
    if (!this.options.resubmitter) throw new ComplianceError("SUBMISSION_NOT_WIRED", "Submitting invoices to ZATCA is not enabled in this installation yet");
    const row = await this.prisma.zatcaInvoiceRecord.findFirstOrThrow({ where: { salesInvoiceId, companyId }, select: { egsUnitId: true } });
    await this.options.resubmitter.enqueue(salesInvoiceId, row.egsUnitId);
    await this.audit.log({ actorId: actor.id, action: "compliance.invoice_resubmit_requested", entityType: "ZatcaInvoiceRecord", entityId: salesInvoiceId, correlationId });
    return record;
  }

  // ── internals ───────────────────────────────────────────────────────────────────────────────────────────

  private service(): OnboardingService {
    try {
      return this.onboarding();
    } catch (error) {
      throw new ComplianceError("ENCRYPTION_KEY_MISSING", error instanceof Error ? error.message : "The encryption key is not configured");
    }
  }

  private async requireUnit(companyId: string, id: string) {
    const unit = await this.prisma.egsUnit.findFirst({ where: { id, companyId }, include: { credential: true } });
    if (!unit) throw new ComplianceError("EGS_NOT_FOUND", "EGS unit not found");
    return unit;
  }

  private async requireCompleteSeller(companyId: string): Promise<ZatcaParty> {
    const profile = await this.sellerProfile(companyId);
    if (!profile.complete) throw new ComplianceError("SELLER_PROFILE_INCOMPLETE", "Complete the seller profile before onboarding", { missing: profile.missing });
    return {
      partyIdentification: { schemeId: profile.crNumberScheme ?? "CRN", id: profile.crNumber ?? "" },
      address: {
        streetName: profile.streetName ?? "",
        ...(profile.additionalStreetName ? { additionalStreetName: profile.additionalStreetName } : {}),
        ...(profile.buildingNumber ? { buildingNumber: profile.buildingNumber } : {}),
        citySubdivisionName: profile.district ?? "",
        cityName: profile.city ?? "",
        postalZone: profile.postalCode ?? "",
        countryCode: profile.countryCode ?? "SA",
      },
      vatNumber: profile.vatNumber ?? "",
      // The Arabic legal name: ZATCA requires it on every invoice regardless of the screen language.
      registrationName: profile.nameAr ?? profile.name,
    };
  }

  // A step that ZATCA (or the network) refused is a normal outcome the screen shows, not a server error. The
  // unit's status does not move, so the step can simply be tried again.
  private async failed(step: OnboardingStepResult["step"], egsStatus: string, error: unknown, actor: Actor, egsUnitId: string, correlationId: string): Promise<OnboardingStepResult> {
    if (error instanceof ComplianceError) throw error;
    if (error instanceof OnboardingError && error.code === "WRONG_STATUS") throw new ComplianceError("WRONG_STATUS", error.message);
    const known = error instanceof ZatcaApiError;
    const result: OnboardingStepResult = {
      step,
      ok: false,
      egsStatus,
      error: {
        code: known ? error.code : "UNEXPECTED",
        message: error instanceof Error ? error.message : "Unknown error",
        ...(known && error.status !== undefined ? { status: error.status } : {}),
        ...(known && error.body !== undefined ? { body: boundedBody(error.body) } : {}),
      },
    };
    await this.audit.log({ actorId: actor.id, action: `compliance.${step.toLowerCase()}_failed`, entityType: "EgsUnit", entityId: egsUnitId, after: { code: result.error?.code, status: result.error?.status }, correlationId });
    return result;
  }

  private egsView(row: {
    id: string;
    name: string;
    serial: string;
    branchName: string | null;
    businessCategory: string;
    invoiceTypes: string;
    environment: string;
    status: string;
    isActive: boolean;
    credential: { status: string; certificateExpiresAt: Date | null; lastRenewalAt: Date | null } | null;
    chainState: { lastIcv: bigint } | null;
  }): EgsUnitView {
    const expires = row.credential?.certificateExpiresAt ?? null;
    const days = expires ? Math.floor((expires.getTime() - this.now().getTime()) / 86_400_000) : null;
    return {
      id: row.id,
      name: row.name,
      serial: row.serial,
      branchName: row.branchName,
      businessCategory: row.businessCategory,
      invoiceTypes: row.invoiceTypes,
      environment: row.environment as ZatcaEnvironment,
      status: row.status,
      isActive: row.isActive,
      credentialStatus: row.credential?.status ?? null,
      certificateExpiresAt: expires?.toISOString() ?? null,
      daysUntilExpiry: days,
      expiry: days === null ? null : days < 0 ? "EXPIRED" : days <= this.expiryWarningDays ? "EXPIRING_SOON" : "OK",
      lastRenewalAt: row.credential?.lastRenewalAt?.toISOString() ?? null,
      lastIcv: (row.chainState?.lastIcv ?? 0n).toString(),
    };
  }
}
