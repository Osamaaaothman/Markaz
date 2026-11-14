import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CostCentersController, SaveCostCenterDto } from "./cost-centers.controller.js";
import { CreateCashExpenseLineDto } from "./dto/payment-dtos.js";
import { PERMISSION_KEY } from "../identity/require-permission.decorator.js";

describe("Cost center API boundary", () => {
  const valid = { code: "P1", name: "Project", kind: "PROJECT", isActive: true };
  it("validates kind, names, active flag and code before writes", async () => {
    for (const invalid of [{ ...valid, kind: "UNKNOWN" }, { ...valid, name: "  " }, { ...valid, code: " " }, { ...valid, isActive: "true" }]) {
      expect((await validate(plainToInstance(SaveCostCenterDto, invalid))).length).toBeGreaterThan(0);
    }
    expect(await validate(plainToInstance(SaveCostCenterDto, valid))).toHaveLength(0);
  });
  it("keeps empty center identifiers out while allowing unallocated lines", async () => {
    const line = { expenseAccountId: "expense", amount: "1.25" };
    expect(await validate(plainToInstance(CreateCashExpenseLineDto, line))).toHaveLength(0);
    expect((await validate(plainToInstance(CreateCashExpenseLineDto, { ...line, costCenterId: "" }))).map(error => error.property)).toContain("costCenterId");
  });
  it("requires read permission for the directory and accounting permissions for mutations", () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, Object.getOwnPropertyDescriptor(CostCentersController.prototype, "list")!.value as object)).toEqual({ resource: "cash_expense", action: "read" });
    expect(Reflect.getMetadata(PERMISSION_KEY, Object.getOwnPropertyDescriptor(CostCentersController.prototype, "create")!.value as object)).toEqual({ resource: "account", action: "create" });
    expect(Reflect.getMetadata(PERMISSION_KEY, Object.getOwnPropertyDescriptor(CostCentersController.prototype, "update")!.value as object)).toEqual({ resource: "account", action: "update" });
  });
});
