// Real database, scripted ZATCA transport (docs/06-COMPLIANCE-PACK-RULES.md §6: never the real
// endpoint in a committed test). Exercises ComplianceAdminService the way compliance.controller.ts
// calls it, proving the HTTP-adjacent layer (status transitions, audit, tenant isolation, secret
// handling) on top of what packages/compliance/zatca-sa/src/onboarding/onboarding.service.spec.ts
// already proves about the onboarding orchestration itself.
import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { AuditEvent, IAuditLogger } from "@erp/core";
import {
  OnboardingService,
  ZatcaOnboardingApiClient,
  type CsidResponseBody,
  type ComplianceCheckResponseBody,
} from "@erp/compliance-zatca-sa";
import type { HttpResponse, HttpTransport } from "@erp/compliance-zatca-sa";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComplianceAdminService } from "./compliance-admin.service.js";

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
function generateTestCertificate(): { certificateBase64: string } {
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
    return { certificateBase64 };
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
  async function createMinimalSalesInvoice(forCompanyId: string): Promise<string> {
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

    // Cross-tenant: another company gets null, not someone else's record.
    expect(await service.invoiceRecord(otherCompanyId, salesInvoiceId)).toBeNull();
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
