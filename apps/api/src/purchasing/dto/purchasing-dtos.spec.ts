import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CreatePurchaseOrderDto,
  CreatePurchaseRequestDto,
  ReceivePurchaseOrderDto,
  RejectPurchaseRequestDto,
  SetApprovalPolicyDto,
} from "./purchasing-dtos.js";

async function fieldsWithErrors<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property).sort();
}

describe("purchase request DTOs", () => {
  it("accepts a request with positive quantities and rejects empty, zero or text quantities", async () => {
    expect(await fieldsWithErrors(CreatePurchaseRequestDto, { lines: [{ itemId: "i1", quantity: "5" }] })).toEqual([]);
    expect(await fieldsWithErrors(CreatePurchaseRequestDto, { lines: [] })).toEqual(["lines"]);
    expect(await fieldsWithErrors(CreatePurchaseRequestDto, { lines: [{ itemId: "i1", quantity: "0" }] })).toEqual(["lines"]);
    expect(await fieldsWithErrors(CreatePurchaseRequestDto, { lines: [{ itemId: "i1", quantity: "ten" }] })).toEqual(["lines"]);
  });

  it("requires a reason to reject", async () => {
    expect(await fieldsWithErrors(RejectPurchaseRequestDto, { reason: "Duplicate" })).toEqual([]);
    expect(await fieldsWithErrors(RejectPurchaseRequestDto, { reason: "" })).toEqual(["reason"]);
  });
});

describe("purchase order DTOs", () => {
  const line = { itemId: "i1", quantity: "10", unitPrice: "12.5" };

  it("accepts an order and allows a zero price (a free sample) but not a negative one", async () => {
    expect(await fieldsWithErrors(CreatePurchaseOrderDto, { supplierId: "s1", orderDate: "2026-01-01", lines: [line] })).toEqual([]);
    expect(await fieldsWithErrors(CreatePurchaseOrderDto, { supplierId: "s1", orderDate: "2026-01-01", lines: [{ ...line, unitPrice: "0" }] })).toEqual([]);
    expect(await fieldsWithErrors(CreatePurchaseOrderDto, { supplierId: "s1", orderDate: "2026-01-01", lines: [{ ...line, unitPrice: "-1" }] })).toEqual(["lines"]);
  });

  it("requires a supplier, a date and at least one line", async () => {
    expect(await fieldsWithErrors(CreatePurchaseOrderDto, { orderDate: "2026-01-01", lines: [line] })).toEqual(["supplierId"]);
    expect(await fieldsWithErrors(CreatePurchaseOrderDto, { supplierId: "s1", orderDate: "soon", lines: [line] })).toEqual(["orderDate"]);
    expect(await fieldsWithErrors(CreatePurchaseOrderDto, { supplierId: "s1", orderDate: "2026-01-01", lines: [] })).toEqual(["lines"]);
  });

  it("validates a receipt against an order", async () => {
    const ok = { warehouseId: "w1", documentDate: "2026-01-01", lines: [{ purchaseOrderLineId: "l1", quantity: "2" }] };
    expect(await fieldsWithErrors(ReceivePurchaseOrderDto, ok)).toEqual([]);
    expect(await fieldsWithErrors(ReceivePurchaseOrderDto, { ...ok, lines: [{ purchaseOrderLineId: "l1", quantity: "0" }] })).toEqual(["lines"]);
  });
});

describe("approval policy DTO", () => {
  it("takes a threshold, or null to remove the policy, but not junk", async () => {
    expect(await fieldsWithErrors(SetApprovalPolicyDto, { thresholdAmount: "5000" })).toEqual([]);
    expect(await fieldsWithErrors(SetApprovalPolicyDto, { thresholdAmount: null })).toEqual([]);
    expect(await fieldsWithErrors(SetApprovalPolicyDto, { thresholdAmount: "-1" })).toEqual(["thresholdAmount"]);
    expect(await fieldsWithErrors(SetApprovalPolicyDto, { thresholdAmount: "lots" })).toEqual(["thresholdAmount"]);
  });
});
