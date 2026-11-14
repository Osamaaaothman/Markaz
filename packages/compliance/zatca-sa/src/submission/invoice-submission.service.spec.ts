import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
// Test-fixture only (posts a real, balanced journal entry so a SalesInvoice row satisfies its
// FK) — zatca-sa's own src never imports @erp/core; see jest.config.cjs's moduleNameMapper.
import { PrismaAccountingEngine, PrismaNumberingService } from "@erp/core";
import type { ZatcaInvoiceInput, ZatcaParty } from "../xml/invoice-xml.types.js";
import { EgsChainService } from "../egs-chain.service.js";
import { AlreadySubmittedError, InvoiceSubmissionService, InvoiceValidationError, type SubmitInvoiceParams } from "./invoice-submission.service.js";
import { generateTestCertificate } from "../testing/fixtures.js";
import { ZatcaApiClient, ZatcaApiError, type HttpResponse, type HttpTransport } from "./zatca-api-client.js";

const describeIfReady = process.env.DATABASE_URL ? describe : describe.skip;

// A scriptable transport: queue up responses (or errors) and they are returned/thrown in order,
// one per call — this is docs/06-COMPLIANCE-PACK-RULES.md §6's "mock adapter by default in CI".
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

const CLEARED_RESPONSE: HttpResponse = {
  status: 200,
  body: { clearanceStatus: "CLEARED", clearedInvoice: Buffer.from("<Invoice>cleared</Invoice>", "utf8").toString("base64"), validationResults: { status: "PASS", warningMessages: [], errorMessages: [] } },
};
const CLEARED_WITH_WARNING_RESPONSE: HttpResponse = {
  status: 200,
  body: { clearanceStatus: "CLEARED", clearedInvoice: null, validationResults: { status: "WARNING", warningMessages: ["minor issue"], errorMessages: [] } },
};
const NOT_CLEARED_RESPONSE: HttpResponse = {
  status: 200,
  body: { clearanceStatus: "NOT_CLEARED", clearedInvoice: null, validationResults: { status: "ERROR", warningMessages: [], errorMessages: ["bad VAT number"] } },
};
const REPORTED_RESPONSE: HttpResponse = {
  status: 200,
  body: { reportingStatus: "REPORTED", validationResults: { status: "PASS", warningMessages: [], errorMessages: [] } },
};

describeIfReady("InvoiceSubmissionService — real database, scripted ZATCA transport", () => {
  const prisma = new PrismaClient();
  const chain = new EgsChainService();
  const companyId = newId();
  let egsUnitId: string;

  const supplier: ZatcaParty = {
    partyIdentification: { schemeId: "CRN", id: "1010010000" },
    address: { streetName: "Prince Sultan", buildingNumber: "2322", citySubdivisionName: "Al-Murabba", cityName: "Riyadh", postalZone: "23333", countryCode: "SA" },
    vatNumber: "399999999900003",
    registrationName: "Maximum Speed Tech Supply LTD",
  };
  const customer: ZatcaParty = {
    address: { streetName: "Salah Al-Din", buildingNumber: "1111", citySubdivisionName: "Al-Murooj", cityName: "Riyadh", postalZone: "12222", countryCode: "SA" },
    vatNumber: "399999999800003",
    registrationName: "Fatoora Samples LTD",
  };
  const { certificatePem, privateKeyPem } = generateTestCertificate();

  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  let fiscalPeriodId: string;
  let arAccountId: string;
  let revenueAccountId: string;
  let customerPartyId: string;

  // ZatcaInvoiceRecord has a real FK to sales_invoices — this posts one minimal, genuinely
  // balanced invoice (via the real accounting engine, not a hand-faked row) purely so the FK is
  // satisfiable. The invoice's own content is irrelevant to every test here, which exercises the
  // ZATCA submission pipeline, not sales accounting.
  async function createMinimalSalesInvoice(): Promise<string> {
    const salesInvoiceId = newId();
    const { journalEntryId } = await prisma.$transaction((tx) =>
      engine.postEntry(
        {
          companyId,
          fiscalPeriodId,
          entryDate: new Date(),
          postingDate: new Date(),
          currency: "SAR",
          lines: [
            { accountId: arAccountId, debit: "4.60", description: "test invoice" },
            { accountId: revenueAccountId, credit: "4.60", description: "test invoice" },
          ],
          sourceModule: "sales",
          sourceDocumentType: "sales_invoice",
          sourceDocumentId: salesInvoiceId,
          actorId: "test",
          correlationId: newId(),
          idempotencyKey: newId(),
        },
        tx,
      ),
    );
    await prisma.salesInvoice.create({
      data: {
        id: salesInvoiceId,
        companyId,
        documentType: "INVOICE",
        number: `TEST-${salesInvoiceId}`,
        customerId: customerPartyId,
        invoiceDate: new Date(),
        currency: "SAR",
        totalNet: "4.00",
        totalTax: "0.60",
        totalGross: "4.60",
        journalEntryId,
        actorId: "test",
        correlationId: newId(),
      },
    });
    return salesInvoiceId;
  }

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Submission Test ${companyId}`, defaultCurrency: "SAR" } });
    const fiscalYear = await prisma.fiscalYear.create({ data: { id: newId(), companyId, name: `FY-${companyId.slice(0, 6)}`, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
    const fiscalPeriod = await prisma.fiscalPeriod.create({ data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
    fiscalPeriodId = fiscalPeriod.id;
    const ar = await prisma.account.create({ data: { id: newId(), ref: `TEST-AR-${companyId.slice(0, 6)}`, companyId, code: "1200", name: "Accounts receivable", type: "ASSET", normalBalance: "DEBIT" } });
    const revenue = await prisma.account.create({ data: { id: newId(), ref: `TEST-REV-${companyId.slice(0, 6)}`, companyId, code: "4100", name: "Sales", type: "REVENUE", normalBalance: "CREDIT" } });
    arAccountId = ar.id;
    revenueAccountId = revenue.id;
    const party = await prisma.party.create({ data: { id: newId(), ref: `TEST-CUST-${companyId.slice(0, 6)}`, companyId, name: "Fatoora Samples LTD", kind: "COMPANY" } });
    customerPartyId = party.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const egsUnit = await prisma.egsUnit.create({
      data: { id: newId(), companyId, name: "Till", serial: `1-MarkazPOS|2-M1|3-${newId()}`, businessCategory: "Retail", invoiceTypes: "1100", environment: "sandbox" },
    });
    egsUnitId = egsUnit.id;
    await prisma.$transaction((tx) => chain.createFor(tx, companyId, egsUnitId));
  });

  async function makeParams(overrides: Partial<SubmitInvoiceParams> & { transport: HttpTransport }): Promise<SubmitInvoiceParams & { service: InvoiceSubmissionService }> {
    const salesInvoiceId = overrides.salesInvoiceId ?? (await createMinimalSalesInvoice());
    const service = new InvoiceSubmissionService(prisma, chain, () => new ZatcaApiClient("sandbox", overrides.transport));
    const base: SubmitInvoiceParams = {
      companyId,
      egsUnitId,
      salesInvoiceId,
      environment: "sandbox",
      credentials: { binarySecurityToken: "token", secret: "secret" },
      certificatePem,
      privateKeyPem,
      isSimplified: false,
      signingTime: "2026-11-04T12:00:00",
      acceptLanguage: "en",
      qr: { sellerName: "Maximum Speed Tech Supply LTD", vatNumber: "399999999900003", timestamp: "2026-11-04T12:00:00", invoiceTotalWithVat: "4.60", vatTotal: "0.60" },
      buildInvoiceInput: (chainValues): ZatcaInvoiceInput => ({
        subtype: overrides.isSimplified ? "SIMPLIFIED" : "STANDARD",
        documentType: "INVOICE",
        id: `INV-${salesInvoiceId}`,
        uuid: newId(),
        issueDate: "2026-11-04",
        issueTime: "12:00:00",
        currency: "SAR",
        icv: chainValues.icv.toString(),
        previousInvoiceHash: chainValues.previousInvoiceHash,
        supplier,
        customer: overrides.isSimplified ? undefined : customer,
        paymentMeansCode: "10",
        lines: [{ id: "1", quantity: "1", unitCode: "PCE", lineExtensionAmount: "4.00", taxAmount: "0.60", itemName: "Item", taxCategoryId: "S", taxPercent: "15.00", priceAmount: "4.00" }],
      }),
      ...overrides,
    };
    return { ...base, service };
  }

  it("clears a standard invoice, advances the chain, and persists the cleared XML", async () => {
    const transport = new ScriptedTransport().queue(CLEARED_RESPONSE);
    const { service, ...params } = await makeParams({ transport });
    const result = await service.submit(params);

    expect(result.outcome.complianceOutcome).toEqual({ kind: "CLEARED" });
    const record = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { id: result.zatcaInvoiceRecordId } });
    expect(record.status).toBe("CLEARED");
    expect(record.clearedXml).toBe("<Invoice>cleared</Invoice>");
    expect(record.icv).toBe(1n);

    const state = await prisma.egsChainState.findUniqueOrThrow({ where: { egsUnitId } });
    expect(state.lastIcv).toBe(1n);
    expect(state.lastInvoiceHash).toBe(record.invoiceHash);
  });

  it("stops on a local validation error: nothing is sent, the chain is untouched, and a fixed resubmission reuses the same ICV", async () => {
    const transport = new ScriptedTransport().queue(CLEARED_RESPONSE);
    const { service, ...params } = await makeParams({ transport });
    const good = params.buildInvoiceInput;
    // A mapper bug: the seller's VAT number is not 15 digits.
    const broken: SubmitInvoiceParams = { ...params, buildInvoiceInput: (c) => ({ ...good(c), supplier: { ...supplier, vatNumber: "12345" } }) };

    await expect(service.submit(broken)).rejects.toBeInstanceOf(InvoiceValidationError);
    expect(transport.calls).toHaveLength(0);

    const record = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { salesInvoiceId: params.salesInvoiceId } });
    expect(record.status).toBe("FAILED_RETRYABLE");
    expect(record.attempts).toBe(0);
    expect((record.validationErrors as string[]).join(" ")).toContain("SELLER_VAT_INVALID");
    expect((await prisma.egsChainState.findUniqueOrThrow({ where: { egsUnitId } })).lastIcv).toBe(0n);

    const result = await service.submit(params);
    expect(result.outcome.complianceOutcome).toEqual({ kind: "CLEARED" });
    expect(result.zatcaInvoiceRecordId).toBe(record.id);
    expect((await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { id: record.id } })).icv).toBe(record.icv);
  });

  it("refuses to send a QR code that disagrees with the document", async () => {
    const transport = new ScriptedTransport();
    const { service, ...params } = await makeParams({ transport });
    await expect(service.submit({ ...params, qr: { ...params.qr, vatTotal: "9.99" } })).rejects.toMatchObject({ name: "InvoiceValidationError", stage: "AFTER_SIGNING" });
    expect(transport.calls).toHaveLength(0);
  });

  it("reports a simplified invoice", async () => {
    const transport = new ScriptedTransport().queue(REPORTED_RESPONSE);
    const { service, ...params } = await makeParams({ transport, isSimplified: true });
    const result = await service.submit(params);
    expect(result.outcome.complianceOutcome).toEqual({ kind: "REPORTED" });
    const record = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { id: result.zatcaInvoiceRecordId } });
    expect(record.status).toBe("REPORTED");
    expect(record.reportedAt).not.toBeNull();
  });

  it("records ACCEPTED_WITH_WARNINGS and still advances the chain", async () => {
    const transport = new ScriptedTransport().queue(CLEARED_WITH_WARNING_RESPONSE);
    const { service, ...params } = await makeParams({ transport });
    const result = await service.submit(params);
    expect(result.outcome.complianceOutcome).toEqual({ kind: "ACCEPTED_WITH_WARNINGS", warnings: ["minor issue"] });
    const state = await prisma.egsChainState.findUniqueOrThrow({ where: { egsUnitId } });
    expect(state.lastIcv).toBe(1n);
  });

  it("marks a rejected invoice REJECTED and still consumes the ICV (a correction is a new document)", async () => {
    const transport = new ScriptedTransport().queue(NOT_CLEARED_RESPONSE);
    const { service, ...params } = await makeParams({ transport });
    const result = await service.submit(params);
    expect(result.outcome.complianceOutcome).toEqual({ kind: "REJECTED", reason: "bad VAT number" });
    const state = await prisma.egsChainState.findUniqueOrThrow({ where: { egsUnitId } });
    expect(state.lastIcv).toBe(1n); // consumed, not rolled back

    await expect(service.submit(params)).rejects.toBeInstanceOf(AlreadySubmittedError);
  });

  it("continues generation after a transient failure and retries older invoices without rewinding the chain", async () => {
    const transport = new ScriptedTransport().queue(new ZatcaApiError("SERVER_ERROR", "ZATCA had a bad day", 503));
    const { service, ...params } = await makeParams({ transport });

    const first = await service.submit(params);
    expect(first.outcome.complianceOutcome).toEqual({ kind: "PENDING_RETRY" });
    const recordAfterFailure = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { id: first.zatcaInvoiceRecordId } });
    expect(recordAfterFailure.status).toBe("FAILED_RETRYABLE");
    expect(recordAfterFailure.icv).toBe(1n);
    const stateAfterFailure = await prisma.egsChainState.findUniqueOrThrow({ where: { egsUnitId } });
    expect(stateAfterFailure.lastIcv).toBe(1n);
    const followingTransport = new ScriptedTransport().queue(CLEARED_RESPONSE);
    const { service: followingService, ...followingParams } = await makeParams({ transport: followingTransport });
    const following = await followingService.submit(followingParams);
    const followingRecord = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { id: following.zatcaInvoiceRecordId } });
    expect(followingRecord.icv).toBe(2n);
    expect(followingRecord.previousInvoiceHash).toBe(recordAfterFailure.invoiceHash);

    // Retry: same salesInvoiceId, now the transport succeeds.
    transport.queue(CLEARED_RESPONSE);
    const second = await service.submit({ ...params, isSimplified: true, signingTime: "2026-11-05T13:00:00", buildInvoiceInput: () => { throw new Error("A retry must not remap an invoice"); } });
    expect(second.zatcaInvoiceRecordId).toBe(first.zatcaInvoiceRecordId); // same record, resumed
    expect(second.outcome.complianceOutcome).toEqual({ kind: "CLEARED" });
    const recordAfterRetry = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { id: first.zatcaInvoiceRecordId } });
    expect(recordAfterRetry.icv).toBe(1n); // same ICV reused, not a new one
    expect(recordAfterRetry.attempts).toBe(2);
    expect(transport.calls[1]!.body).toEqual(transport.calls[0]!.body);
    expect(transport.calls[1]!.url).toEqual(transport.calls[0]!.url);
    expect(recordAfterRetry.uuid).toBe(params.salesInvoiceId);
    const history = await prisma.zatcaSubmissionAttempt.findMany({ where: { recordId: recordAfterRetry.id }, orderBy: { startedAt: "asc" } });
    expect(history.map((attempt) => attempt.status)).toEqual(["FAILED_RETRYABLE", "CLEARED"]);
    expect(history[0]!.httpStatus).toBe(503);
    const stateAfterRetry = await prisma.egsChainState.findUniqueOrThrow({ where: { egsUnitId } });
    expect(stateAfterRetry.lastIcv).toBe(2n);
    expect(stateAfterRetry.lastInvoiceHash).toBe(followingRecord.invoiceHash);
  });

  it("keeps generated chain evidence on an auth error and recovers a legacy unadvanced signed tail", async () => {
    const transport = new ScriptedTransport().queue(new ZatcaApiError("AUTH_ERROR", "bad credentials", 401));
    const { service, ...params } = await makeParams({ transport });
    const result = await service.submit(params);
    expect(result.outcome.complianceOutcome).toEqual({ kind: "PACK_UNAVAILABLE" });
    const state = await prisma.egsChainState.findUniqueOrThrow({ where: { egsUnitId } });
    expect(state.lastIcv).toBe(1n);
    const original = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { id: result.zatcaInvoiceRecordId } });
    // Simulate the pre-fix state: bytes persisted, HTTP 401, chain still at genesis.
    await prisma.egsChainState.update({ where: { egsUnitId }, data: { lastIcv: 0n, lastInvoiceHash: null } });
    const nextTransport = new ScriptedTransport().queue(CLEARED_RESPONSE);
    const { service: nextService, ...nextParams } = await makeParams({ transport: nextTransport });
    const nextResult = await nextService.submit(nextParams);
    const next = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { id: nextResult.zatcaInvoiceRecordId } });
    expect(next.icv).toBe(2n);
    expect(next.previousInvoiceHash).toBe(original.invoiceHash);
    const preserved = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { id: original.id } });
    expect(preserved).toEqual(original);
  });

  it("assigns strictly sequential ICVs to successive invoices on the same EGS", async () => {
    const transportA = new ScriptedTransport().queue(CLEARED_RESPONSE);
    const { service: serviceA, ...paramsA } = await makeParams({ transport: transportA });
    const resultA = await serviceA.submit(paramsA);

    const transportB = new ScriptedTransport().queue(CLEARED_RESPONSE);
    const { service: serviceB, ...paramsB } = await makeParams({ transport: transportB });
    const resultB = await serviceB.submit(paramsB);

    const recordA = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { id: resultA.zatcaInvoiceRecordId } });
    const recordB = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { id: resultB.zatcaInvoiceRecordId } });
    expect(recordA.icv).toBe(1n);
    expect(recordB.icv).toBe(2n);
    expect(recordB.previousInvoiceHash).toBe(recordA.invoiceHash);
  });

  it("many invoices submitted one after another on the same EGS (the real shape: a per-EGS BullMQ worker at concurrency 1) stay gapless", async () => {
    const COUNT = 12;
    let previousHash: string | null = null;
    for (let i = 1; i <= COUNT; i++) {
      const transport = new ScriptedTransport().queue(CLEARED_RESPONSE);
      const { service, ...params } = await makeParams({ transport });
      const result = await service.submit(params);
      const record = await prisma.zatcaInvoiceRecord.findUniqueOrThrow({ where: { id: result.zatcaInvoiceRecordId } });
      expect(record.icv).toBe(BigInt(i));
      if (previousHash) expect(record.previousInvoiceHash).toBe(previousHash);
      previousHash = record.invoiceHash;
    }
    expect((await prisma.egsChainState.findUniqueOrThrow({ where: { egsUnitId } })).lastIcv).toBe(BigInt(COUNT));
  });

  // Exercise the database uniqueness guarantee if the per-EGS concurrency-1 contract is violated.
  it("concurrent submissions stay gapless, retrying a reservation collision before HTTP when necessary", async () => {
    const transportA = new ScriptedTransport().queue(CLEARED_RESPONSE);
    const transportB = new ScriptedTransport().queue(CLEARED_RESPONSE);
    const { service: serviceA, ...paramsA } = await makeParams({ transport: transportA });
    const { service: serviceB, ...paramsB } = await makeParams({ transport: transportB });

    const [settledA, settledB] = await Promise.allSettled([serviceA.submit(paramsA), serviceB.submit(paramsB)]);
    const outcomes = [settledA, settledB];
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    // The chain now advances before HTTP. Depending on scheduling, the second reservation
    // either collides and retries, or sees the next free position. Both must remain gapless.
    if (settledA.status === "rejected") {
      expect(settledA.reason).toMatchObject({ code: "P2002" });
      expect(transportA.calls).toHaveLength(0);
      await serviceA.submit(paramsA);
    }
    if (settledB.status === "rejected") {
      expect(settledB.reason).toMatchObject({ code: "P2002" });
      expect(transportB.calls).toHaveLength(0);
      await serviceB.submit(paramsB);
    }
    const records = await prisma.zatcaInvoiceRecord.findMany({ where: { egsUnitId }, orderBy: { icv: "asc" } });
    expect(records.map((record) => record.icv)).toEqual([1n, 2n]);
    expect(new Set(records.map((record) => record.salesInvoiceId))).toEqual(new Set([paramsA.salesInvoiceId, paramsB.salesInvoiceId]));
    expect(records[1]!.previousInvoiceHash).toBe(records[0]!.invoiceHash);
    expect(transportA.calls).toHaveLength(1);
    expect(transportB.calls).toHaveLength(1);
    expect((await prisma.egsChainState.findUniqueOrThrow({ where: { egsUnitId } })).lastIcv).toBe(2n);
  });
});
