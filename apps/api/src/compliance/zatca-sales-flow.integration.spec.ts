import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { AccountMappingService, PrismaAccountingEngine, PrismaAuditLogger, PrismaNumberingService, SalesInvoiceService, TaxCodeService } from "@erp/core";
import { EgsChainService, InvoiceSubmissionService, OnboardingService, ZatcaApiClient, encryptText, invoiceQrArtifact, parseQrTlv, readInvoiceArtifacts, findSdkJar, runSdkValidation, type ClearanceRequestBody, type HttpResponse, type HttpTransport } from "@erp/compliance-zatca-sa";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZatcaInvoiceMapper } from "./zatca-invoice-mapper.js";
import { ComplianceAdminService } from "./compliance-admin.service.js";
import { salesInvoiceToPdfHtml } from "../sales/exports/sales-invoice-export.js";

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;
jest.setTimeout(30_000);
const key = Buffer.alloc(32, 23);
const sdkRoot = process.env.ZATCA_SDK_DIR ?? join(__dirname, "../../../../docs/vendor/zatca/sdk");
const sdkCert = join(sdkRoot, "Data/Certificates/cert.pem");
const sdkKey = join(sdkRoot, "Data/Certificates/ec-secp256k1-priv-key.pem");
const sdkAvailable = Boolean(findSdkJar(sdkRoot)) && existsSync(sdkCert) && existsSync(sdkKey);
if (process.env.ZATCA_REQUIRE_SDK === "1" && (!sdkAvailable || !process.env.DATABASE_URL)) {
  throw new Error("ZATCA release gate requires both DATABASE_URL and the official SDK; sales-flow validation cannot be skipped.");
}

/** A deliberately synthetic authority response; no network or real credentials in this test. */
class EchoAuthority implements HttpTransport {
  readonly calls: { url: string; body: ClearanceRequestBody }[] = [];
  request(_method: "POST" | "PATCH", url: string, _headers: Record<string, string>, raw: unknown): Promise<HttpResponse> {
    const body = raw as ClearanceRequestBody;
    this.calls.push({ url, body });
    const xml = Buffer.from(body.invoice, "base64").toString("utf8");
    const artifact = readInvoiceArtifacts(xml);
    expect(artifact.uuid).toBe(body.uuid);
    const validationResults = { status: "WARNING", warningMessages: [{ type: "WARNING", code: "TEST-WARNING", message: "Synthetic integration fixture" }], errorMessages: [] };
    if (url.includes("reporting")) return Promise.resolve({ status: 200, body: { reportingStatus: "REPORTED", validationResults } });
    const tags = parseQrTlv(artifact.qr!);
    const changedQr = Buffer.concat([...tags].map(([tag, value]) => {
      const bytes = tag === 7 ? Buffer.from("synthetic-authority-signature") : value;
      return Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);
    })).toString("base64");
    return Promise.resolve({ status: 200, body: { clearanceStatus: "CLEARED", clearedInvoice: Buffer.from(xml.replace(artifact.qr!, changedQr)).toString("base64"), validationResults } });
  }
}

describeWithDb("Sales to ZATCA — posted invoice, return and debit note", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const sales = new SalesInvoiceService(prisma, new PrismaAccountingEngine(prisma, new PrismaNumberingService()), mappings, audit);
  const companyId = newId();
  const actor = { id: "zatca-flow-test", companyId };
  const now = new Date();
  let taxCodeId: string;
  let cert: string;
  let privateKey: string;
  const enqueued: string[] = [];
  const admin = new ComplianceAdminService(prisma, () => new OnboardingService(prisma, key), audit, {
    defaultEnvironment: "sandbox", resubmitter: { enqueue: (invoiceId) => { enqueued.push(invoiceId); return Promise.resolve(); } },
  });

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "zatca-sales-fixture-"));
    try {
      execFileSync("openssl", ["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", join(dir, "key.pem")], { stdio: "pipe" });
      execFileSync("openssl", ["req", "-new", "-x509", "-key", join(dir, "key.pem"), "-subj", "/C=SA/O=Test/CN=Test", "-days", "1", "-out", join(dir, "cert.pem")], { stdio: "pipe" });
      cert = readFileSync(join(dir, "cert.pem"), "utf8"); privateKey = readFileSync(join(dir, "key.pem"), "utf8");
    } finally { rmSync(dir, { recursive: true, force: true }); }
    await prisma.company.create({ data: { id: companyId, name: "ZATCA test company", nameAr: "شركة الاختبار", defaultCurrency: "SAR", vatNumber: "399999999900003", crNumber: "1010010000", crNumberScheme: "CRN", streetName: "King Fahd", buildingNumber: "1234", district: "Olaya", city: "Riyadh", postalCode: "12345", countryCode: "SA" } });
    const year = await prisma.fiscalYear.create({ data: { id: newId(), companyId, name: "Test year", startDate: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), endDate: new Date(Date.UTC(now.getUTCFullYear(), 11, 31)) } });
    await prisma.fiscalPeriod.create({ data: { id: newId(), companyId, fiscalYearId: year.id, periodNumber: 1, startDate: year.startDate, endDate: year.endDate } });
    for (const [code, mapping, type, normalBalance] of [["1200", "ACCOUNTS_RECEIVABLE", "ASSET", "DEBIT"], ["4100", "SALES_REVENUE", "REVENUE", "CREDIT"], ["2300", "VAT_OUTPUT", "LIABILITY", "CREDIT"]] as const) {
      const account = await prisma.account.create({ data: { id: newId(), ref: newId(), companyId, code, name: mapping, type, normalBalance } });
      await mappings.set(mapping, account.id, actor, newId());
    }
    taxCodeId = (await new TaxCodeService(prisma, audit).addSaudiDefaults(actor, newId())).find((tax) => tax.code === "VAT15")!.id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("offers a separately labeled Sandbox data QR without changing failed submission evidence", async () => {
    const egs = await admin.createEgsUnit({ name: "Data preview", businessCategory: "Retail", invoiceTypes: "1100", environment: "sandbox" }, actor, newId());
    await prisma.egsUnit.update({ where: { id: egs.id }, data: { status: "ACTIVE" } });
    const customer = await prisma.party.create({ data: { id: newId(), companyId, ref: newId(), name: "Preview customer", kind: "CUSTOMER" } });
    const invoice = await sales.createInvoice({ customerId: customer.id, invoiceDate: now, egsUnitId: egs.id, lines: [{ description: "Preview service", quantity: "1", unitPrice: "100", taxCodeId }] }, actor, newId(), newId());
    const record = await prisma.zatcaInvoiceRecord.create({ data: { id: newId(), companyId, salesInvoiceId: invoice.id, egsUnitId: egs.id, uuid: invoice.id, icv: 1n, previousInvoiceHash: "test-only", status: "FAILED_RETRYABLE", validationErrors: ["SIGNATURE_INVALID"] } });
    const view = await admin.invoiceRecord(companyId, invoice.id);
    expect(view).toMatchObject({ status: "FAILED_RETRYABLE", qrCode: null, qrSource: null, qrImageDataUrl: null, hasSignedXml: false, attempts: 0, errors: ["SIGNATURE_INVALID"] });
    const tags = parseQrTlv(view!.dataPreviewQrCode!);
    expect([...tags.keys()]).toEqual([1, 2, 3, 4, 5]);
    expect(tags.get(4)!.toString()).toBe("115.00");
    expect(tags.get(5)!.toString()).toBe("15.00");
    expect(await admin.invoiceRecord(newId(), invoice.id)).toBeNull();
    const print = await admin.invoicePrintData(companyId, invoice.id);
    const html = await salesInvoiceToPdfHtml({ invoice: await sales.get(companyId, invoice.id), language: "ar", companyName: "Test", compliance: print });
    expect(html).toContain("غير معتمد من زاتكا");
    expect(html).toContain(view!.dataPreviewQrImageDataUrl!);
    expect(await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { id: record.id } })).toEqual(record);
    await prisma.egsUnit.update({ where: { id: egs.id }, data: { environment: "production" } });
    expect((await admin.invoiceRecord(companyId, invoice.id))!.dataPreviewQrImageDataUrl).toBeNull();
  });

  it.each([
    { simplified: false, environment: "simulation" as const },
    { simplified: true, environment: "simulation" as const },
    { simplified: false, environment: "sandbox" as const },
    { simplified: true, environment: "sandbox" as const },
  ])("submits all three documents using the issuance CSID ($environment, simplified=$simplified)", async (scenario) => runSalesFlow(scenario));

  (sdkAvailable ? it : it.skip).each([false, true])(
    "official SDK accepts posted invoice, credit and debit XML from the sales mapper (simplified=%s)",
    async (simplified) => runSalesFlow({ simplified, environment: "simulation", validateWithSdk: true }),
    180_000,
  );

  async function runSalesFlow({ simplified, environment, validateWithSdk = false }: { simplified: boolean; environment: "sandbox" | "simulation"; validateWithSdk?: boolean }): Promise<void> {
    const egs = await admin.createEgsUnit({ name: `Test ${environment} ${simplified}`, businessCategory: "Retail", invoiceTypes: "1100", environment }, actor, newId());
    await prisma.egsUnit.update({ where: { id: egs.id }, data: { status: "ACTIVE" } });
    const encrypted = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(encryptText(value, key));
    // Public SDK fixtures are used only in this isolated test company, never in an application EGS.
    await prisma.egsCredential.create({ data: { id: newId(), companyId, egsUnitId: egs.id, status: "ACTIVE", privateKeyCiphertext: encrypted(validateWithSdk ? readFileSync(sdkKey, "utf8") : privateKey), productionCsidCiphertext: encrypted(validateWithSdk ? readFileSync(sdkCert, "utf8") : cert), productionSecretCiphertext: encrypted("synthetic-secret"), complianceCsidCiphertext: encrypted("not-a-production-certificate") } });
    const customer = await prisma.party.create({ data: { id: newId(), ref: newId(), companyId, name: "Test customer", nameAr: "عميل تجريبي", kind: "COMPANY", ...(simplified ? {} : { vatNumber: "399999999800003", streetName: "King Road", buildingNumber: "1234", district: "Olaya", city: "Riyadh", postalCode: "12345", countryCode: "SA" }) } });
    const line = { description: "خدمة اختبار", quantity: "1", unitPrice: "100", taxCodeId };
    const invoice = await sales.createInvoice({ customerId: customer.id, invoiceDate: now, egsUnitId: egs.id, lines: [line] }, actor, newId(), newId());
    expect((await admin.invoiceStatuses(companyId, [invoice.id]))[invoice.id]?.status).toBe("NOT_SUBMITTED");
    expect((await admin.invoices(companyId, { status: "NOT_SUBMITTED", environment })).data.some((row) => row.salesInvoiceId === invoice.id)).toBe(true);
    await admin.resubmit(companyId, invoice.id, actor, newId());
    expect(enqueued).toContain(invoice.id);
    const original = await sales.get(companyId, invoice.id);
    const credit = await sales.createCreditNote({ originalInvoiceId: invoice.id, creditDate: now, notes: "استرجاع تجريبي", lines: [{ ...line, originalLineId: original.lines[0]!.id, unitPrice: "100" }] }, actor, newId(), newId());
    const debit = await sales.createDebitNote({ originalInvoiceId: invoice.id, debitDate: now, notes: "تعديل تجريبي", lines: [{ ...line, unitPrice: "20" }] }, actor, newId(), newId());
    const authority = new EchoAuthority();
    const submitter = new InvoiceSubmissionService(prisma, new EgsChainService(), (env) => new ZatcaApiClient(env, authority));
    const mapper = new ZatcaInvoiceMapper(prisma, key);
    let previousHash: string | null = null;
    for (const [index, document] of [invoice, credit, debit].entries()) {
      const outbox = await prisma.outboxMessage.findFirstOrThrow({ where: { companyId, topic: `zatca-submission-${egs.id}`, payload: { path: ["salesInvoiceId"], equals: document.id } } });
      const mapped = await mapper.load({ companyId, correlationId: outbox.correlationId, outboxMessageId: outbox.id, payload: outbox.payload });
      expect(mapped.credentials.secret).toBe("synthetic-secret");
      await submitter.submit(mapped);
      const stored = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { salesInvoiceId: document.id } });
      if (validateWithSdk) {
        const documentType = ["INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"][index]!;
        const dir = mkdtempSync(join(tmpdir(), "zatca-sales-sdk-"));
        try {
          const path = join(dir, `${simplified ? "simplified" : "standard"}-${documentType}.xml`);
          expect(stored.signedXml).not.toBeNull();
          writeFileSync(path, stored.signedXml!, "utf8");
          // Validate the actual persisted XML before the synthetic authority response changes it.
          const result = await runSdkValidation({ sdkDir: sdkRoot, xmlPath: path, previousInvoiceHash: stored.previousInvoiceHash });
          expect({ document: documentType, verdict: result.verdict, exitCode: result.exitCode, output: result.verdict === "PASSED" && result.exitCode === 0 ? "" : result.output })
            .toEqual({ document: documentType, verdict: "PASSED", exitCode: 0, output: "" });
        } finally { rmSync(dir, { recursive: true, force: true }); }
      }
      expect(stored.icv).toBe(BigInt(index + 1));
      if (previousHash) expect(stored.previousInvoiceHash).toBe(previousHash);
      previousHash = stored.invoiceHash;
      const detail = await admin.invoiceRecord(companyId, document.id);
      expect(detail).toMatchObject({ status: "ACCEPTED_WITH_WARNINGS", uuid: document.id, qrSource: simplified ? "SIGNED" : "CLEARED", attempts: 1 });
      expect(detail!.warnings).toEqual(["TEST-WARNING: Synthetic integration fixture"]);
      expect(detail!.history).toHaveLength(1);
      expect(detail!.qrImageDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(simplified ? detail!.reportedAt : detail!.clearedAt).not.toBeNull();
      expect(simplified ? detail!.clearedAt : detail!.reportedAt).toBeNull();
      expect(detail!.qrCode).toBe(invoiceQrArtifact(stored.signedXml, stored.clearedXml)?.qr);
      if (!simplified) expect(detail!.qrCode).not.toBe(readInvoiceArtifacts(stored.signedXml!).qr);
      expect(await admin.invoiceRecord(newId(), document.id)).toBeNull();
      await expect(admin.xml(newId(), document.id, "signed")).rejects.toMatchObject({ code: "INVOICE_RECORD_NOT_FOUND" });
      await expect(admin.resubmit(companyId, document.id, actor, newId())).rejects.toMatchObject({ code: "WRONG_STATUS" });
      const html = await salesInvoiceToPdfHtml({ invoice: await sales.get(companyId, document.id), language: "ar", companyName: "شركة الاختبار", compliance: await admin.invoicePrintData(companyId, document.id) });
      expect(html).toContain("مستند تجريبي"); expect(html).toContain(detail!.qrImageDataUrl);
      if (process.env.ZATCA_QA_OUTPUT_DIR) {
        mkdirSync(process.env.ZATCA_QA_OUTPUT_DIR, { recursive: true });
        writeFileSync(join(process.env.ZATCA_QA_OUTPUT_DIR, `${simplified ? "simplified" : "standard"}-${index}.html`), html);
        writeFileSync(join(process.env.ZATCA_QA_OUTPUT_DIR, `${simplified ? "simplified" : "standard"}-${index}.qr.txt`), detail!.qrCode!);
      }
    }
    expect(authority.calls).toHaveLength(3);
    expect(authority.calls.every((call) => call.url.includes(environment === "sandbox" ? "developer-portal" : "simulation"))).toBe(true);
    const firstPage = await admin.invoices(companyId, { limit: 1, environment, documentType: "CREDIT_NOTE" });
    expect(firstPage.data[0]!.documentType).toBe("CREDIT_NOTE");
    expect((await admin.invoices(newId(), {})).data).toEqual([]);
  }
});
