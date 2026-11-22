import type { TransactionClient } from "@erp/core";
import { SalesInvoiceIssueGuard } from "./sales-invoice-issue.guard.js";

const xml = (typeName: string): string =>
  `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"><cbc:UUID>u-1</cbc:UUID><cbc:InvoiceTypeCode name="${typeName}">388</cbc:InvoiceTypeCode></Invoice>`;

const txWith = (record: { status: string; signedXml: string | null } | null): TransactionClient =>
  ({ zatcaInvoiceRecord: { findFirst: () => Promise.resolve(record) } }) as unknown as TransactionClient;

describe("SalesInvoiceIssueGuard.validateVoid", () => {
  const guard = new SalesInvoiceIssueGuard();
  const input = { companyId: "c", salesInvoiceId: "i" };

  it("allows a standard invoice ZATCA rejected", async () => {
    await expect(guard.validateVoid(txWith({ status: "REJECTED", signedXml: xml("0100000") }), input)).resolves.toBeUndefined();
  });

  it.each([null, { status: "CLEARED", signedXml: xml("0100000") }, { status: "FAILED_RETRYABLE", signedXml: xml("0100000") }])(
    "refuses an invoice ZATCA did not reject (%p)",
    async (record) => {
      await expect(guard.validateVoid(txWith(record), input)).rejects.toMatchObject({ code: "COMPLIANCE_VOID_NOT_REJECTED" });
    },
  );

  it("refuses a rejected simplified invoice until its procedure is confirmed", async () => {
    await expect(guard.validateVoid(txWith({ status: "REJECTED", signedXml: xml("0200000") }), input)).rejects.toMatchObject({ code: "COMPLIANCE_VOID_SIMPLIFIED_UNSUPPORTED" });
  });
});
