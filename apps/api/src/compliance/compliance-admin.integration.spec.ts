// Real database, scripted ZATCA transport (docs/06-COMPLIANCE-PACK-RULES.md §6: never the real
// endpoint in a committed test). Exercises ComplianceAdminService the way compliance.controller.ts
// calls it, proving the HTTP-adjacent layer (status transitions, audit, tenant isolation, secret
// handling) on top of what packages/compliance/zatca-sa/src/onboarding/onboarding.service.spec.ts
// already proves about the onboarding orchestration itself.
import "reflect-metadata";
import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { AuditEvent, IAuditLogger } from "@erp/core";
import {
  OnboardingService,
  ZatcaOnboardingApiClient,
  encryptText,
  type CsidResponseBody,
  type ComplianceCheckResponseBody,
} from "@erp/compliance-zatca-sa";
import type { HttpResponse, HttpTransport } from "@erp/compliance-zatca-sa";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComplianceAdminService } from "./compliance-admin.service.js";
import { UpdateSellerProfileDto } from "./compliance.dto.js";
import { plainToInstance } from "class-transformer";

const describeIfReady = process.env.DATABASE_URL ? describe : describe.skip;

class ScriptedTransport implements HttpTransport {
  private readonly script: (HttpResponse | Error)[] = [];
  readonly calls: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];

  queue(...responses: (HttpResponse | Error)[]): this {
    this.script.push(...responses);
    return this;
  }

  request(method: "POST" | "PATCH", url: string, headers: Record<string, string>, body: unknown): Promise<HttpResponse> {
    this.calls.push({ method, url, headers, body });
    const next = this.script.shift();
    if (!next) throw new Error("ScriptedTransport ran out of queued responses");
    if (next instanceof Error) throw next;
    return Promise.resolve(next);
  }
}

class RecordingAuditLogger implements IAuditLogger {
  readonly events: AuditEvent[] = [];
  log(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

const ENCRYPTION_KEY = Buffer.from("k".repeat(32), "utf8");

// A throw-away self-signed certificate, generated the same way
// packages/compliance/zatca-sa/src/testing/fixtures.ts does for the pack's own tests. Duplicated
// here (not imported across the package boundary) because that fixture is deliberately test-only
// and not part of the pack's public API (docs/02-ARCHITECTURE-RULES.md §1). Needed because
// onboarding.service.ts parses the server-returned certificate with node:crypto's
// X509Certificate to read its expiry — a scripted response must be a real, parseable cert.
function generateTestCertificate(): { certificateBase64: string; privateKeyPem: string } {
  const dir = mkdtempSync(join(tmpdir(), "zatca-admin-test-cert-"));
  try {
    const keyPath = join(dir, "key.pem");
    const certPath = join(dir, "cert.pem");
    execFileSync("openssl", ["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", keyPath], { stdio: "pipe" });
    execFileSync("openssl", ["req", "-new", "-x509", "-key", keyPath, "-subj", "/C=SA/O=Markaz Test/CN=markaz-test-egs", "-days", "1825", "-sha256", "-out", certPath], { stdio: "pipe" });
    const certificateBase64 = readFileSync(certPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("-----"))
      .join("");
    return { certificateBase64, privateKeyPem: readFileSync(keyPath, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const testCertificate = generateTestCertificate();

describeIfReady("ComplianceAdminService — real database, scripted ZATCA transport", () => {
  const prisma = new PrismaClient();
  let companyId: string;
  let otherCompanyId: string;
  let audit: RecordingAuditLogger;
  let service: ComplianceAdminService;
  let actor: { id: string; companyId: string };

  const completeProfile = {
    vatNumber: "399999999900003",
    crNumber: "1010010000",
    crNumberScheme: "CRN",
    streetName: "Prince Sultan",
    buildingNumber: "2322",
    district: "Al-Murabba",
    city: "Riyadh",
    postalCode: "23333",
    countryCode: "SA",
    nameAr: "اسم الشركة",
  };

  function makeService(transport: HttpTransport): ComplianceAdminService {
    audit = new RecordingAuditLogger();
    return new ComplianceAdminService(prisma, () => new OnboardingService(prisma, ENCRYPTION_KEY, (env) => new ZatcaOnboardingApiClient(env, transport)), audit, { defaultEnvironment: "sandbox" });
  }

  // ZatcaInvoiceRecord.salesInvoiceId has a real FK to sales_invoices — this builds just enough
  // of a real chain (fiscal year/period, two accounts, a customer party, a balanced journal
  // entry, the invoice itself) to satisfy it. Not a realistic posting (the compliance pack does
  // not care, and this is not an accounting test); accounting correctness of this fixture is out
  // of scope here — packages/core/src/sales/sales.integration.spec.ts covers that.
  async function createMinimalSalesInvoice(forCompanyId: string, egsUnitId?: string): Promise<string> {
    const unique = newId();
    const year = await prisma.fiscalYear.create({ data: { id: newId(), companyId: forCompanyId, name: `FY-Test-${unique}`, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
    const period = await prisma.fiscalPeriod.create({ data: { id: newId(), companyId: forCompanyId, fiscalYearId: year.id, periodNumber: 1, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
    const debitAccount = await prisma.account.create({ data: { id: newId(), companyId: forCompanyId, ref: `ACC-D-${unique}`, code: `1-${unique}`, name: "Test Receivable", type: "ASSET", normalBalance: "DEBIT" } });
    const creditAccount = await prisma.account.create({ data: { id: newId(), companyId: forCompanyId, ref: `ACC-C-${unique}`, code: `4-${unique}`, name: "Test Revenue", type: "REVENUE", normalBalance: "CREDIT" } });
    const journalEntry = await prisma.journalEntry.create({
      data: {
        id: newId(),
        companyId: forCompanyId,
        fiscalPeriodId: period.id,
        number: `JE-TEST-${unique}`,
        entryDate: new Date("2026-06-01"),
        postingDate: new Date("2026-06-01"),
        currency: "SAR",
        sourceModule: "sales",
        sourceDocumentType: "SALES_INVOICE",
        sourceDocumentId: newId(),
        actorId: newId(),
        correlationId: newId(),
        idempotencyKey: newId(),
        lines: {
          create: [
            { id: newId(), lineNumber: 1, accountId: debitAccount.id, debit: "100.0000", baseDebit: "100.0000" },
            { id: newId(), lineNumber: 2, accountId: creditAccount.id, credit: "100.0000", baseCredit: "100.0000" },
          ],
        },
      },
    });
    const customer = await prisma.party.create({ data: { id: newId(), companyId: forCompanyId, ref: `PRT-${unique}`, name: "Test Customer", kind: "COMPANY" } });
    const invoice = await prisma.salesInvoice.create({
      data: {
        id: newId(),
        companyId: forCompanyId,
        documentType: "INVOICE",
        ...(egsUnitId ? { egsUnitId } : {}),
        number: `TEST-${unique}`,
        customerId: customer.id,
        invoiceDate: new Date("2026-06-01"),
        currency: "SAR",
        totalNet: "100.0000",
        totalTax: "0.0000",
        totalGross: "100.0000",
        journalEntryId: journalEntry.id,
        actorId: newId(),
        correlationId: newId(),
      },
    });
    return invoice.id;
  }

  beforeAll(async () => {
    companyId = newId();
    otherCompanyId = newId();
    await prisma.company.create({ data: { id: companyId, name: `Compliance Admin Test ${companyId}`, defaultCurrency: "SAR" } });
    await prisma.company.create({ data: { id: otherCompanyId, name: `Other Company ${otherCompanyId}`, defaultCurrency: "SAR" } });
    actor = { id: newId(), companyId };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    service = makeService(new ScriptedTransport());
  });

  // ── seller profile ────────────────────────────────────────────────────────────────────────

  it("reports which fields are missing, and locks once a certificate has been issued", async () => {
    const empty = await service.sellerProfile(companyId);
    expect(empty.complete).toBe(false);
    expect(empty.missing).toContain("vatNumber");
    expect(empty.locked).toBe(false);

    const updated = await service.updateSellerProfile(completeProfile, actor, newId());
    expect(updated.complete).toBe(true);
    expect(updated.missing).toEqual([]);
    expect(updated.locked).toBe(false);

    // Issue a credential directly (onboarding is covered separately below) to simulate "locked".
    const egs = await prisma.egsUnit.create({ data: { id: newId(), companyId, name: "Till-lock", serial: `1-M|2-M|3-${newId()}`, businessCategory: "Retail", invoiceTypes: "1000", environment: "sandbox" } });
    await prisma.egsCredential.create({ data: { id: newId(), egsUnitId: egs.id, companyId, status: "COMPLIANCE_CSID_ISSUED" } });

    const locked = await service.sellerProfile(companyId);
    expect(locked.locked).toBe(true);
    await expect(service.updateSellerProfile({ vatNumber: "399999999900004" }, actor, newId())).rejects.toMatchObject({ code: "SELLER_LOCKED" });
    // A no-op edit (same value, or editing a field not covered by the certificate) is not a change.
    await expect(service.updateSellerProfile({ vatNumber: completeProfile.vatNumber }, actor, newId())).resolves.toMatchObject({ locked: true });
  });

  // Regression: a plain object `{ field }` with unset keys simply absent is not what the controller actually
  // passes. Nest's ValidationPipe builds the input via class-transformer's `plainToInstance`, and on this API's
  // ES2022 target every `@IsOptional()` class field is an own property (value `undefined`) whether the client
  // sent it or not. A field check that used `field in input` passed every test above (plain objects have no such
  // property) while still wiping every other seller-profile field on a real HTTP request. This test goes through
  // the same `plainToInstance` step the controller does, so it only passes if the service tells "sent" apart from
  // "declared on the class" correctly.
  it("a partial update built the way Nest's ValidationPipe builds it does not touch fields the client did not send", async () => {
    await service.updateSellerProfile(completeProfile, actor, newId());

    const partial = plainToInstance(UpdateSellerProfileDto, { countryCode: "SA" });
    const after = await service.updateSellerProfile(partial, actor, newId());

    expect(after).toMatchObject({ ...completeProfile, countryCode: "SA" });
    expect(after.complete).toBe(true);
    expect(after.missing).toEqual([]);
  });

  // ── EGS units ─────────────────────────────────────────────────────────────────────────────

  it("creates an EGS unit with its chain row, and getEgsUnit/listEgsUnits agree", async () => {
    const view = await service.createEgsUnit({ name: "Branch 1 till", businessCategory: "Retail", invoiceTypes: "1100" }, actor, newId());
    expect(view.status).toBe("NEW");
    expect(view.lastIcv).toBe("0");

    const chain = await prisma.egsChainState.findUnique({ where: { egsUnitId: view.id } });
    expect(chain).not.toBeNull();

    const fetched = await service.getEgsUnit(companyId, view.id);
    expect(fetched).toEqual(view);
    const list = await service.listEgsUnits(companyId);
    expect(list.map((u) => u.id)).toContain(view.id);

    expect(audit.events.some((e) => e.action === "compliance.egs_created" && e.entityId === view.id)).toBe(true);
  });

  // ── onboarding, end to end through the admin service ─────────────────────────────────────

  it("walks compliance CSID -> compliance checks (all pass) -> production CSID, and an OTP never appears in results or audit rows", async () => {
    await service.updateSellerProfile(completeProfile, actor, newId());
    const egs = await service.createEgsUnit({ name: "Till-flow", businessCategory: "Retail", invoiceTypes: "1000" }, actor, newId()); // standard only -> 3 compliance samples

    const transport = new ScriptedTransport().queue(
      { status: 200, body: { requestID: "req-1", binarySecurityToken: testCertificate.certificateBase64, secret: "compliance-secret" } satisfies CsidResponseBody },
    );
    service = makeService(transport);
    await service.updateSellerProfile(completeProfile, actor, newId());

    const otp = "123345";
    const started = await service.startOnboarding(egs.id, otp, actor, newId());
    expect(started).toMatchObject({ step: "COMPLIANCE_CSID", ok: true, egsStatus: "COMPLIANCE_CSID_ISSUED" });
    // The OTP went out on the wire (that's the whole point) but never comes back in the result or an audit row.
    expect(transport.calls[0]!.headers.OTP).toBe(otp);
    expect(JSON.stringify(started)).not.toContain(otp);
    for (const event of audit.events) expect(JSON.stringify(event)).not.toContain(otp);

    const checksTransport = new ScriptedTransport();
    for (let i = 0; i < 3; i++) {
      checksTransport.queue({ status: 200, body: { clearanceStatus: "CLEARED", validationResults: { status: "PASS", warningMessages: [], errorMessages: [] } } satisfies ComplianceCheckResponseBody });
    }
    const checkService = new ComplianceAdminService(prisma, () => new OnboardingService(prisma, ENCRYPTION_KEY, (env) => new ZatcaOnboardingApiClient(env, checksTransport)), audit, { defaultEnvironment: "sandbox" });
    const checks = await checkService.runComplianceChecks(egs.id, actor, newId());
    expect(checks.ok).toBe(true);
    expect(checks.checks).toHaveLength(3);
    expect(checks.checks!.every((c) => c.ok)).toBe(true);
    expect(checks.egsStatus).toBe("COMPLIANCE_CHECKS_PASSED");

    const prodTransport = new ScriptedTransport().queue({ status: 200, body: { requestID: "req-2", binarySecurityToken: testCertificate.certificateBase64, secret: "production-secret" } satisfies CsidResponseBody });
    const prodService = new ComplianceAdminService(prisma, () => new OnboardingService(prisma, ENCRYPTION_KEY, (env) => new ZatcaOnboardingApiClient(env, prodTransport)), audit, { defaultEnvironment: "sandbox" });
    const production = await prodService.requestProductionCsid(egs.id, actor, newId());
    expect(production).toMatchObject({ step: "PRODUCTION_CSID", ok: true, egsStatus: "ACTIVE" });

    const final = await service.getEgsUnit(companyId, egs.id);
    expect(final.status).toBe("ACTIVE");
    expect(final.credentialStatus).toBe("ACTIVE");
  });

  it("a renewal requiring checks pauses the unit, resumes through all six checks, and exposes no credentials", async () => {
    await service.updateSellerProfile(completeProfile, actor, newId());
    const egs = await service.createEgsUnit({ name: "Till-renewal", businessCategory: "Retail", invoiceTypes: "1100", environment: "simulation" }, actor, newId());
    const encrypted = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(encryptText(value, ENCRYPTION_KEY));
    await prisma.egsUnit.update({ where: { id: egs.id }, data: { status: "ACTIVE" } });
    await prisma.egsCredential.create({ data: { id: newId(), companyId, egsUnitId: egs.id, status: "ACTIVE", privateKeyCiphertext: encrypted(testCertificate.privateKeyPem), productionCsidCiphertext: encrypted(testCertificate.certificateBase64), productionSecretCiphertext: encrypted("previous-secret") } });
    const chain = await prisma.egsChainState.update({ where: { egsUnitId: egs.id }, data: { lastIcv: 17n, lastInvoiceHash: "unchanged" } });
    const transport = new ScriptedTransport().queue({ status: 428, body: { requestID: 1730365866069, dispositionMessage: "NOT_COMPLIANT", binarySecurityToken: testCertificate.certificateBase64, secret: "renewal-secret" } });
    service = makeService(transport);
    await expect(service.renew(egs.id, "654321", { id: actor.id, companyId: otherCompanyId }, newId())).rejects.toMatchObject({ code: "EGS_NOT_FOUND" });
    expect(transport.calls).toHaveLength(0);
    const renewal = await service.renew(egs.id, "654321", actor, newId());
    expect(renewal).toEqual({ step: "RENEWAL", ok: true, egsStatus: "COMPLIANCE_CSID_ISSUED" });
    expect(await service.getEgsUnit(companyId, egs.id)).toMatchObject({ status: "COMPLIANCE_CSID_ISSUED", credentialStatus: "COMPLIANCE_CSID_ISSUED", lastRenewalAt: null });
    expect(audit.events.some((event) => event.action === "compliance.renewal_checks_required")).toBe(true);
    for (let index = 0; index < 6; index++) transport.queue({ status: 200, body: { clearanceStatus: "CLEARED", reportingStatus: "REPORTED", validationResults: { status: "PASS", errorMessages: [], warningMessages: [] } } });
    const checks = await service.runComplianceChecks(egs.id, actor, newId());
    expect(checks.ok).toBe(true);
    expect(checks.checks).toHaveLength(6);
    transport.queue({ status: 200, body: { requestID: "new-pcsid", binarySecurityToken: testCertificate.certificateBase64, secret: "new-production-secret" } });
    const issued = await service.requestProductionCsid(egs.id, actor, newId());
    expect(issued.egsStatus).toBe("ACTIVE");
    const view = await service.getEgsUnit(companyId, egs.id);
    expect(view).toMatchObject({ status: "ACTIVE", credentialStatus: "ACTIVE" });
    expect(view.lastRenewalAt).not.toBeNull();
    expect(await prisma.egsChainState.findUniqueOrThrow({ where: { egsUnitId: egs.id } })).toEqual(chain);
    const visible = JSON.stringify([renewal, checks, issued, view, audit.events]);
    for (const secret of ["654321", "renewal-secret", "new-production-secret", testCertificate.certificateBase64, testCertificate.privateKeyPem]) expect(visible).not.toContain(secret);
    transport.queue({ status: 428, body: { dispositionMessage: "NOT_COMPLIANT", binarySecurityToken: testCertificate.certificateBase64, secret: "must-not-leak" } });
    const failed = await service.renew(egs.id, "654321", actor, newId());
    expect(failed).toMatchObject({ ok: false, egsStatus: "ACTIVE", error: { code: "CLIENT_ERROR" } });
    expect(failed.error).not.toHaveProperty("body");
    expect(JSON.stringify(failed)).not.toContain("must-not-leak");
  });

  it("a failing sample keeps the unit at COMPLIANCE_CSID_ISSUED and reports every failure, not just the first", async () => {
    await service.updateSellerProfile(completeProfile, actor, newId());
    const onboardTransport = new ScriptedTransport().queue({ status: 200, body: { requestID: "req-3", binarySecurityToken: testCertificate.certificateBase64, secret: "s" } satisfies CsidResponseBody });
    service = makeService(onboardTransport);
    await service.updateSellerProfile(completeProfile, actor, newId());
    const egs = await service.createEgsUnit({ name: "Till-fail", businessCategory: "Retail", invoiceTypes: "1000" }, actor, newId());
    await service.startOnboarding(egs.id, "123345", actor, newId());

    // 3 samples for "1000" (standard only): first fails, second and third pass — proves every one is attempted.
    const checksTransport = new ScriptedTransport().queue(
      { status: 200, body: { clearanceStatus: "NOT_CLEARED", validationResults: { status: "FAIL", warningMessages: [], errorMessages: ["bad"] } } satisfies ComplianceCheckResponseBody },
      { status: 200, body: { clearanceStatus: "CLEARED", validationResults: { status: "PASS", warningMessages: [], errorMessages: [] } } satisfies ComplianceCheckResponseBody },
      { status: 200, body: { clearanceStatus: "CLEARED", validationResults: { status: "PASS", warningMessages: [], errorMessages: [] } } satisfies ComplianceCheckResponseBody },
    );
    const checkService = new ComplianceAdminService(prisma, () => new OnboardingService(prisma, ENCRYPTION_KEY, (env) => new ZatcaOnboardingApiClient(env, checksTransport)), audit, { defaultEnvironment: "sandbox" });
    const result = await checkService.runComplianceChecks(egs.id, actor, newId());

    expect(result.ok).toBe(false);
    expect(result.checks).toHaveLength(3); // all three attempted, not stopped at the first failure
    expect(result.checks!.filter((c) => !c.ok)).toHaveLength(1);
    expect(result.egsStatus).toBe("COMPLIANCE_CSID_ISSUED"); // did not advance

    const stillAt = await checkService.getEgsUnit(companyId, egs.id);
    // egsUnit.status moved to COMPLIANCE_CSID_ISSUED on startOnboarding already; a failed check
    // must not advance it to COMPLIANCE_CHECKS_PASSED, but it does not roll back either.
    expect(stillAt.status).toBe("COMPLIANCE_CSID_ISSUED");
    expect(stillAt.credentialStatus).toBe("COMPLIANCE_CSID_ISSUED");
  });

  // ── tenant isolation ──────────────────────────────────────────────────────────────────────

  it("another company's EGS unit is not found, not a cross-tenant read", async () => {
    const mine = await service.createEgsUnit({ name: "Mine", businessCategory: "Retail", invoiceTypes: "1000" }, actor, newId());
    await expect(service.getEgsUnit(otherCompanyId, mine.id)).rejects.toMatchObject({ code: "EGS_NOT_FOUND" });
    const otherActor = { id: newId(), companyId: otherCompanyId };
    await expect(service.startOnboarding(mine.id, "123345", otherActor, newId())).rejects.toMatchObject({ code: "EGS_NOT_FOUND" });
  });

  // ── invoice records never expose ciphertext ──────────────────────────────────────────────

  it("invoiceRecord never includes signed/cleared XML content or any key material, only booleans and metadata", async () => {
    const egs = await service.createEgsUnit({ name: "Till-inv", businessCategory: "Retail", invoiceTypes: "1000" }, actor, newId());
    const salesInvoiceId = await createMinimalSalesInvoice(companyId);
    await prisma.zatcaInvoiceRecord.create({
      data: {
        id: newId(),
        companyId,
        salesInvoiceId,
        egsUnitId: egs.id,
        uuid: newId(),
        icv: 1,
        previousInvoiceHash: "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==",
        status: "CLEARED",
        signedXml: "<Invoice>secret content should never leak</Invoice>",
        clearedXml: "<Invoice>cleared</Invoice>",
        qrCode: "AQhTZWxsZXI=",
      },
    });

    const record = await service.invoiceRecord(companyId, salesInvoiceId);
    expect(record).not.toBeNull();
    expect(record!.hasSignedXml).toBe(true);
    expect(record!.hasClearedXml).toBe(true);
    expect(JSON.stringify(record)).not.toContain("secret content");
    expect(JSON.stringify(record)).not.toContain("<Invoice>");

    await prisma.zatcaInvoiceRecord.update({ where: { salesInvoiceId }, data: {
      status: "ACCEPTED_WITH_WARNINGS", lastResponse: { clearanceStatus: "CLEARED", validationResults: { warningMessages: [{ code: "BR-KSA-15", message: "Delivery date required" }] }, secret: "never-return-response" },
    } });
    const accepted = await service.invoiceRecord(companyId, salesInvoiceId);
    expect(accepted).toMatchObject({ status: "ACCEPTED_WITH_WARNINGS", authorityStatus: "CLEARED", warnings: ["BR-KSA-15: Delivery date required"], canResubmit: false });
    expect(JSON.stringify(accepted)).not.toContain("never-return-response");
    await prisma.zatcaInvoiceRecord.update({ where: { salesInvoiceId }, data: {
      status: "REJECTED",
    } });
    expect((await service.invoiceRecord(companyId, salesInvoiceId))!.authorityStatus).toBeNull();

    await prisma.zatcaInvoiceRecord.update({ where: { salesInvoiceId }, data: {
      status: "REJECTED", validationErrors: ["ZATCA rejected the request (HTTP 400)"],
      lastResponse: { code: "CLIENT_ERROR", status: 400, body: { secret: "never-return-response", validationResults: { errorMessages: [{ code: "certificate-permissions", message: "Seller VAT mismatch" }], warningMessages: [] } } },
    } });
    const rejected = await service.invoiceRecord(companyId, salesInvoiceId);
    expect(rejected!.errors).toEqual(["certificate-permissions: Seller VAT mismatch"]);
    expect(rejected!.canResubmit).toBe(false);
    expect(JSON.stringify(rejected)).not.toContain("never-return-response");

    // Cross-tenant: another company gets null, not someone else's record.
    expect(await service.invoiceRecord(otherCompanyId, salesInvoiceId)).toBeNull();
  // Real database reads plus two QR PNG encodes run alongside the Java SDK in CI.
  // This is an integration correctness check, not a five-second performance budget.
  }, 30_000);

  it("reports certificate mismatch and the blocking invoice without leaking secrets or queueing work", async () => {
    const egs = await service.createEgsUnit({ name: "Till-readiness", businessCategory: "Retail", invoiceTypes: "1000" }, actor, newId());
    const first = await createMinimalSalesInvoice(companyId, egs.id);
    const next = await createMinimalSalesInvoice(companyId, egs.id);
    const encrypted = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(encryptText(value, ENCRYPTION_KEY));
    const otherCertificate = generateTestCertificate();
    await prisma.egsCredential.create({ data: { id: newId(), companyId, egsUnitId: egs.id,
      privateKeyCiphertext: encrypted(testCertificate.privateKeyPem), productionCsidCiphertext: encrypted(otherCertificate.certificateBase64),
      productionSecretCiphertext: encrypted("never-return-me"), status: "ACTIVE",
    } });
    await prisma.egsUnit.update({ where: { id: egs.id }, data: { status: "ACTIVE" } });
    await prisma.zatcaInvoiceRecord.create({ data: { id: newId(), companyId, salesInvoiceId: first, egsUnitId: egs.id, uuid: first, icv: 1n, previousInvoiceHash: "unused-test-hash", status: "FAILED_RETRYABLE", validationErrors: ["SIGNATURE_INVALID"] } });
    const enqueue = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);
    const readyService = new ComplianceAdminService(prisma, () => new OnboardingService(prisma, ENCRYPTION_KEY), audit, { defaultEnvironment: "sandbox", resubmitter: { enqueue } });
    const readiness = await readyService.submissionReadiness(companyId, next);
    expect(readiness).toMatchObject({ canSubmit: false, issue: "CERTIFICATE_KEY_MISMATCH", blockingInvoice: { id: first } });
    expect(JSON.stringify(readiness)).not.toContain("never-return-me");
    expect(JSON.stringify(readiness)).not.toContain("PRIVATE KEY");
    await expect(readyService.submissionReadiness(otherCompanyId, next)).rejects.toMatchObject({ code: "INVOICE_RECORD_NOT_FOUND" });
    await expect(readyService.resubmit(companyId, next, actor, newId())).rejects.toMatchObject({ code: "SUBMISSION_BLOCKED" });
    expect(enqueue).not.toHaveBeenCalled();
    await prisma.egsCredential.update({ where: { egsUnitId: egs.id }, data: { productionCsidCiphertext: encrypted(testCertificate.certificateBase64) } });
    expect(await readyService.submissionReadiness(companyId, next)).toMatchObject({ canSubmit: false, issue: "CHAIN_BLOCKED" });
    expect(await readyService.submissionReadiness(companyId, first)).toEqual({ canSubmit: true, issue: null, blockingInvoice: null });
    expect(await readyService.resubmit(companyId, first, actor, newId())).toEqual({ status: "QUEUED" });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(first, egs.id);
    await prisma.zatcaInvoiceRecord.update({ where: { salesInvoiceId: first }, data: {
      status: "REJECTED", lastResponse: { body: { validationResults: { errorMessages: [{ code: "certificate-permissions", message: "Seller VAT mismatch" }] } } },
    } });
    // A generated predecessor no longer holds the next position. Sandbox may still test
    // another document; Simulation/Production must refuse the known identity mismatch.
    await prisma.zatcaInvoiceRecord.update({ where: { salesInvoiceId: first }, data: { signedXml: "previously-generated-test-document", invoiceHash: "test-hash" } });
    expect(await readyService.submissionReadiness(companyId, next)).toEqual({ canSubmit: true, issue: null, blockingInvoice: null, warning: "CERTIFICATE_SELLER_MISMATCH" });
    expect(await readyService.resubmit(companyId, next, actor, newId())).toEqual({ status: "QUEUED" });
    expect(enqueue).toHaveBeenCalledTimes(2);
    await prisma.egsUnit.update({ where: { id: egs.id }, data: { environment: "simulation" } });
    expect(await readyService.submissionReadiness(companyId, next)).toMatchObject({ canSubmit: false, issue: "CERTIFICATE_SELLER_MISMATCH" });
    await expect(readyService.resubmit(companyId, next, actor, newId())).rejects.toMatchObject({ code: "SUBMISSION_BLOCKED" });
    expect(enqueue).toHaveBeenCalledTimes(2);
    await prisma.egsUnit.update({ where: { id: egs.id }, data: { environment: "production" } });
    expect(await readyService.submissionReadiness(companyId, next)).toMatchObject({ canSubmit: false, issue: "CERTIFICATE_SELLER_MISMATCH" });
    const oldRejection = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { salesInvoiceId: first } });
    const accepted = await createMinimalSalesInvoice(companyId, egs.id);
    await prisma.zatcaInvoiceRecord.create({ data: { id: newId(), companyId, salesInvoiceId: accepted, egsUnitId: egs.id, uuid: accepted, icv: 2n, previousInvoiceHash: "test-hash", signedXml: "accepted-test-document", invoiceHash: "accepted-hash", status: "ACCEPTED_WITH_WARNINGS", updatedAt: new Date(oldRejection.updatedAt.getTime() + 1000) } });
    expect(await readyService.submissionReadiness(companyId, next)).toEqual({ canSubmit: true, issue: null, blockingInvoice: null });
    expect((await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { salesInvoiceId: first } })).status).toBe("REJECTED");
    // A rejection newer than that acceptance is still actionable.
    await prisma.zatcaInvoiceRecord.update({ where: { salesInvoiceId: first }, data: { updatedAt: new Date(oldRejection.updatedAt.getTime() + 2000) } });
    expect((await readyService.submissionReadiness(companyId, next)).issue).toBe("CERTIFICATE_SELLER_MISMATCH");
    await prisma.egsCredential.update({ where: { egsUnitId: egs.id }, data: { updatedAt: new Date(oldRejection.updatedAt.getTime() + 3000) } });
    expect((await readyService.submissionReadiness(companyId, next)).issue).not.toBe("CERTIFICATE_SELLER_MISMATCH");

  });

  it("resubmit throws SUBMISSION_NOT_WIRED when no Resubmitter is configured (the current, deliberate state)", async () => {
    const egs = await service.createEgsUnit({ name: "Till-resubmit", businessCategory: "Retail", invoiceTypes: "1000" }, actor, newId());
    const salesInvoiceId = await createMinimalSalesInvoice(companyId);
    await prisma.zatcaInvoiceRecord.create({
      data: { id: newId(), companyId, salesInvoiceId, egsUnitId: egs.id, uuid: newId(), icv: 1, previousInvoiceHash: "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==", status: "FAILED_RETRYABLE" },
    });
    await expect(service.resubmit(companyId, salesInvoiceId, actor, newId())).rejects.toMatchObject({ code: "SUBMISSION_NOT_WIRED" });
  });
});
