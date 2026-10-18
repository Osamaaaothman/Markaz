import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateEmployeeDto, CreatePayrollRunDto, GrantSalaryAdvanceDto, SettleEndOfServiceDto, UpdateEmployeeDto } from "./hr-dtos.js";

async function fieldsWithErrors<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property).sort();
}

const VALID_EMPLOYEE = {
  name: "Sara Ahmed",
  nationalId: "1234567890",
  isSaudi: true,
  bankIban: "SA0380000000608010167519",
  hireDate: "2026-01-01",
  basicSalary: "6000",
};

describe("CreateEmployeeDto", () => {
  it("accepts a minimal valid employee", async () => {
    expect(await fieldsWithErrors(CreateEmployeeDto, VALID_EMPLOYEE)).toEqual([]);
  });

  it("requires name, national id, bank IBAN, hire date and a positive basic salary", async () => {
    expect(await fieldsWithErrors(CreateEmployeeDto, { ...VALID_EMPLOYEE, name: "" })).toEqual(["name"]);
    expect(await fieldsWithErrors(CreateEmployeeDto, { ...VALID_EMPLOYEE, nationalId: "" })).toEqual(["nationalId"]);
    expect(await fieldsWithErrors(CreateEmployeeDto, { ...VALID_EMPLOYEE, bankIban: "" })).toEqual(["bankIban"]);
    expect(await fieldsWithErrors(CreateEmployeeDto, { ...VALID_EMPLOYEE, hireDate: "not-a-date" })).toEqual(["hireDate"]);
    expect(await fieldsWithErrors(CreateEmployeeDto, { ...VALID_EMPLOYEE, basicSalary: "0" })).toEqual(["basicSalary"]);
  });

  it("rejects a non-boolean isSaudi", async () => {
    expect(await fieldsWithErrors(CreateEmployeeDto, { ...VALID_EMPLOYEE, isSaudi: "yes" })).toEqual(["isSaudi"]);
  });

  it("accepts optional housing and other allowances as decimal strings, zero included", async () => {
    expect(await fieldsWithErrors(CreateEmployeeDto, { ...VALID_EMPLOYEE, housingAllowance: "0", otherAllowances: "1500" })).toEqual([]);
    expect(await fieldsWithErrors(CreateEmployeeDto, { ...VALID_EMPLOYEE, housingAllowance: "not-a-number" })).toEqual(["housingAllowance"]);
  });
});

describe("UpdateEmployeeDto", () => {
  it("accepts an empty patch and a partial one", async () => {
    expect(await fieldsWithErrors(UpdateEmployeeDto, {})).toEqual([]);
    expect(await fieldsWithErrors(UpdateEmployeeDto, { isActive: false })).toEqual([]);
  });
});

describe("CreatePayrollRunDto", () => {
  it("accepts a valid period and run date", async () => {
    expect(await fieldsWithErrors(CreatePayrollRunDto, { periodYear: 2026, periodMonth: 10, runDate: "2026-10-18" })).toEqual([]);
  });

  it("rejects a month outside 1-12 and a year outside the sane range", async () => {
    expect(await fieldsWithErrors(CreatePayrollRunDto, { periodYear: 2026, periodMonth: 13, runDate: "2026-10-18" })).toEqual(["periodMonth"]);
    expect(await fieldsWithErrors(CreatePayrollRunDto, { periodYear: 1999, periodMonth: 10, runDate: "2026-10-18" })).toEqual(["periodYear"]);
  });
});

describe("GrantSalaryAdvanceDto", () => {
  const valid = { employeeId: "e1", grantDate: "2026-10-18", amount: "1000", installmentAmount: "250", cashAccountId: "a1" };

  it("accepts a valid advance", async () => {
    expect(await fieldsWithErrors(GrantSalaryAdvanceDto, valid)).toEqual([]);
  });

  it("rejects a zero or negative amount or installment", async () => {
    expect(await fieldsWithErrors(GrantSalaryAdvanceDto, { ...valid, amount: "0" })).toEqual(["amount"]);
    expect(await fieldsWithErrors(GrantSalaryAdvanceDto, { ...valid, installmentAmount: "0" })).toEqual(["installmentAmount"]);
  });
});

describe("SettleEndOfServiceDto", () => {
  it("accepts a valid settlement for each reason", async () => {
    for (const reason of ["RESIGNATION", "TERMINATION", "OTHER"]) {
      expect(await fieldsWithErrors(SettleEndOfServiceDto, { employeeId: "e1", terminationDate: "2026-10-18", reason })).toEqual([]);
    }
  });

  it("rejects an unknown reason", async () => {
    expect(await fieldsWithErrors(SettleEndOfServiceDto, { employeeId: "e1", terminationDate: "2026-10-18", reason: "QUIT" })).toEqual(["reason"]);
  });
});
