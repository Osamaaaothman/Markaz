import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateCreditNoteDto, CreateQuotationDto, CreateSalesInvoiceDto } from "./sales-dtos.js";

async function fieldsWithErrors<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property).sort();
}

const itemLine = { itemId: "i1", quantity: "3", unitPrice: "100", taxCodeId: "t1" };
const serviceLine = { description: "Delivery", quantity: "1", unitPrice: "200", taxCodeId: "t1" };

describe("quotation DTO", () => {
  it("accepts item and service lines and rejects bad amounts or no lines", async () => {
    expect(await fieldsWithErrors(CreateQuotationDto, { customerId: "c1", quotationDate: "2026-01-01", lines: [itemLine, serviceLine] })).toEqual([]);
    expect(await fieldsWithErrors(CreateQuotationDto, { customerId: "c1", quotationDate: "2026-01-01", lines: [] })).toEqual(["lines"]);
    expect(await fieldsWithErrors(CreateQuotationDto, { customerId: "c1", quotationDate: "2026-01-01", lines: [{ ...itemLine, quantity: "-1" }] })).toEqual(["lines"]);
    expect(await fieldsWithErrors(CreateQuotationDto, { customerId: "c1", quotationDate: "soon", lines: [itemLine] })).toEqual(["quotationDate"]);
  });
});

describe("sales invoice DTO", () => {
  it("takes a warehouse, an order line and a revenue account on a line", async () => {
    const line = { ...itemLine, warehouseId: "w1", salesOrderLineId: "l1", revenueAccountId: "a1" };
    expect(await fieldsWithErrors(CreateSalesInvoiceDto, { customerId: "c1", invoiceDate: "2026-01-01", lines: [line] })).toEqual([]);
  });

  it("rejects a missing customer or tax code", async () => {
    expect(await fieldsWithErrors(CreateSalesInvoiceDto, { invoiceDate: "2026-01-01", lines: [itemLine] })).toEqual(["customerId"]);
    expect(await fieldsWithErrors(CreateSalesInvoiceDto, { customerId: "c1", invoiceDate: "2026-01-01", lines: [{ ...itemLine, taxCodeId: undefined }] })).toEqual(["lines"]);
  });
});

describe("credit note DTO", () => {
  it("needs a description and a positive quantity on every line", async () => {
    expect(await fieldsWithErrors(CreateCreditNoteDto, { creditDate: "2026-01-01", lines: [{ description: "Damaged", quantity: "1", unitPrice: "100", taxCodeId: "t1" }] })).toEqual([]);
    expect(await fieldsWithErrors(CreateCreditNoteDto, { creditDate: "2026-01-01", lines: [{ description: "", quantity: "1", unitPrice: "100", taxCodeId: "t1" }] })).toEqual(["lines"]);
    expect(await fieldsWithErrors(CreateCreditNoteDto, { creditDate: "2026-01-01", lines: [{ description: "x", quantity: "0", unitPrice: "100", taxCodeId: "t1" }] })).toEqual(["lines"]);
  });
});
