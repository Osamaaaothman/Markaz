import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreatePaymentDto, OpenInvoicesQueryDto } from "./payment-dtos.js";

async function fieldsWithErrors<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property).sort();
}

const base = { partyId: "p1", paymentDate: "2026-01-01", amount: "600", cashAccountId: "a1", method: "BANK_TRANSFER", allocations: [{ invoiceId: "i1", amount: "600" }] };

describe("payment DTO", () => {
  it("accepts a payment with allocations, or none (all on account)", async () => {
    expect(await fieldsWithErrors(CreatePaymentDto, base)).toEqual([]);
    expect(await fieldsWithErrors(CreatePaymentDto, { ...base, allocations: [] })).toEqual([]);
  });

  it("rejects a zero or text amount, an unknown method and a bad allocation", async () => {
    expect(await fieldsWithErrors(CreatePaymentDto, { ...base, amount: "0" })).toEqual(["amount"]);
    expect(await fieldsWithErrors(CreatePaymentDto, { ...base, amount: "lots" })).toEqual(["amount"]);
    expect(await fieldsWithErrors(CreatePaymentDto, { ...base, method: "BARTER" })).toEqual(["method"]);
    expect(await fieldsWithErrors(CreatePaymentDto, { ...base, allocations: [{ invoiceId: "i1", amount: "-5" }] })).toEqual(["allocations"]);
  });
});

describe("open invoices query", () => {
  it("needs a party and a known direction", async () => {
    expect(await fieldsWithErrors(OpenInvoicesQueryDto, { partyId: "p1", direction: "RECEIPT" })).toEqual([]);
    expect(await fieldsWithErrors(OpenInvoicesQueryDto, { partyId: "p1", direction: "SIDEWAYS" })).toEqual(["direction"]);
  });
});
