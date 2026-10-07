import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateTaxCodeDto, SupplierInvoiceDto } from "./invoice-dtos.js";

async function fieldsWithErrors<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property).sort();
}

const base = { supplierId: "s1", supplierInvoiceNumber: "INV-1", invoiceDate: "2026-01-01" };
const poLine = { kind: "PO_LINE", purchaseOrderLineId: "l1", quantity: "4", unitPrice: "40", taxCodeId: "t1" };
const expenseLine = { kind: "EXPENSE", accountId: "a1", quantity: "1", unitPrice: "100", taxCodeId: "t1" };

describe("supplier invoice DTO", () => {
  it("accepts order lines and expense lines", async () => {
    expect(await fieldsWithErrors(SupplierInvoiceDto, { ...base, lines: [poLine, expenseLine] })).toEqual([]);
  });

  it("needs the field that goes with each kind of line", async () => {
    expect(await fieldsWithErrors(SupplierInvoiceDto, { ...base, lines: [{ ...poLine, purchaseOrderLineId: undefined }] })).toEqual(["lines"]);
    expect(await fieldsWithErrors(SupplierInvoiceDto, { ...base, lines: [{ ...expenseLine, accountId: undefined }] })).toEqual(["lines"]);
  });

  it("rejects an unknown kind, bad amounts, a missing number and no lines", async () => {
    expect(await fieldsWithErrors(SupplierInvoiceDto, { ...base, lines: [{ ...poLine, kind: "OTHER" }] })).toEqual(["lines"]);
    expect(await fieldsWithErrors(SupplierInvoiceDto, { ...base, lines: [{ ...poLine, quantity: "0" }] })).toEqual(["lines"]);
    expect(await fieldsWithErrors(SupplierInvoiceDto, { ...base, lines: [{ ...poLine, unitPrice: "-1" }] })).toEqual(["lines"]);
    expect(await fieldsWithErrors(SupplierInvoiceDto, { ...base, supplierInvoiceNumber: "", lines: [poLine] })).toEqual(["supplierInvoiceNumber"]);
    expect(await fieldsWithErrors(SupplierInvoiceDto, { ...base, lines: [] })).toEqual(["lines"]);
  });
});

describe("tax code DTO", () => {
  it("takes a known treatment and a decimal rate", async () => {
    expect(await fieldsWithErrors(CreateTaxCodeDto, { code: "VAT15", name: "VAT 15%", rate: "15", treatment: "STANDARD" })).toEqual([]);
    expect(await fieldsWithErrors(CreateTaxCodeDto, { code: "X", name: "X", rate: "fifteen", treatment: "STANDARD" })).toEqual(["rate"]);
    expect(await fieldsWithErrors(CreateTaxCodeDto, { code: "X", name: "X", rate: "0", treatment: "MAYBE" })).toEqual(["treatment"]);
  });
});
