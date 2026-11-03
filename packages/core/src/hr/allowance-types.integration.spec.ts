import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { AllowanceTypeError, AllowanceTypeService } from "./allowance-type.service.js";
import { EmployeeError, EmployeeService } from "./employee.service.js";
import { EndOfServiceService } from "./end-of-service.service.js";
import { PayrollRunService } from "./payroll-run.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Allowance types — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const mappings = new AccountMappingService(prisma, audit);
  const types = new AllowanceTypeService(prisma, audit);
  const employees = new EmployeeService(prisma, audit);
  const payrollRuns = new PayrollRunService(prisma, engine, mappings, audit);
  const endOfService = new EndOfServiceService(prisma, engine, mappings, audit);

  const cid = (): string => newId();
  const day = new Date(Date.UTC(2026, 9, 18));
  let counter = 0;

  async function company(): Promise<{ companyId: string; actor: { id: string; companyId: string } }> {
    const companyId = newId();
    const actor = { id: "hr-clerk", companyId };
    await prisma.company.create({ data: { id: companyId, name: `Allowances ${companyId}`, defaultCurrency: "SAR" } });
    const fy = await prisma.fiscalYear.create({ data: { id: newId(), companyId, name: `FY2026-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)) } });
    await prisma.fiscalPeriod.create({ data: { id: newId(), companyId, fiscalYearId: fy.id, periodNumber: 1, startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)) } });
    const make = async (code: string, type: string): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `T-${code}-${companyId.slice(0, 6)}`, companyId, code, name: code, type, normalBalance: type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT", isPostable: true } })).id;
    for (const [key, code, type] of [["SALARY_EXPENSE", "5100", "EXPENSE"], ["GOSI_EMPLOYER_EXPENSE", "5110", "EXPENSE"], ["GOSI_PAYABLE", "2110", "LIABILITY"], ["NET_PAY_PAYABLE", "2120", "LIABILITY"], ["SALARY_ADVANCES_RECEIVABLE", "1210", "ASSET"], ["EOSB_EXPENSE", "5120", "EXPENSE"], ["EOSB_PAYABLE", "2130", "LIABILITY"]] as const) {
      await mappings.set(key, await make(code, type), actor, cid());
    }
    return { companyId, actor };
  }

  const hire = (actor: { id: string; companyId: string }, allowances: { allowanceTypeId: string; amount: string }[], isSaudi = true) =>
    employees.create(
      { name: `Worker ${++counter}`, nationalId: `32000${String(++counter).padStart(5, "0")}`, isSaudi, bankIban: "SA0380000000608010167519", hireDate: new Date(Date.UTC(2021, 0, 1)), basicSalary: "6000", allowances },
      actor,
      cid(),
    );

  async function failsWith(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
      return "no error";
    } catch (error) {
      if (error instanceof EmployeeError || error instanceof AllowanceTypeError) return error.code;
      throw error;
    }
  }

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("adds the usual types once, only when asked, and never twice", async () => {
    const { companyId, actor } = await company();
    expect(await types.list(companyId)).toHaveLength(0);
    expect((await types.addCommon(actor, cid())).added).toBe(7);
    expect((await types.addCommon(actor, cid())).added).toBe(0);
    const all = await types.list(companyId);
    expect(all.find((t) => t.code === "HOUSING")).toMatchObject({ isHousing: true, inGosiBase: true, inEosbBase: true });
    expect(all.find((t) => t.code === "TRANSPORT")).toMatchObject({ isHousing: false, inGosiBase: false, inEosbBase: true });
  });

  it("refuses a duplicate code, keeps code and housing marker fixed, and keeps companies apart", async () => {
    const mine = await company();
    const theirs = await company();
    const food = await types.create({ code: "food", name: "Food" }, mine.actor, cid());
    expect(food.code).toBe("FOOD");
    expect(await failsWith(types.create({ code: "FOOD", name: "Again" }, mine.actor, cid()))).toBe("DUPLICATE_CODE");
    await types.create({ code: "FOOD", name: "Their food" }, theirs.actor, cid()); // same code in another company is fine
    expect(await failsWith(types.update(food.id, { name: "Hijack" }, theirs.actor, cid()))).toBe("NOT_FOUND");
    const renamed = await types.update(food.id, { name: "Meals", nameAr: "وجبات" }, mine.actor, cid());
    expect(renamed).toMatchObject({ code: "FOOD", name: "Meals", nameAr: "وجبات", isHousing: false });
  });

  it("stores an employee's allowances, replaces the set on edit, and rejects bad input", async () => {
    const { companyId, actor } = await company();
    const housing = await types.create({ code: "HOUSING", name: "Housing", isHousing: true, inGosiBase: true }, actor, cid());
    const transport = await types.create({ code: "TRANSPORT", name: "Transport" }, actor, cid());
    const other = await company();
    const foreign = await types.create({ code: "X", name: "Foreign" }, other.actor, cid());

    const e = await hire(actor, [{ allowanceTypeId: housing.id, amount: "1500" }, { allowanceTypeId: transport.id, amount: "400" }, { allowanceTypeId: transport.id, amount: "0" }].slice(0, 2));
    expect(e.allowances.map((a) => [a.code, a.amount])).toEqual([["HOUSING", "1500.0000"], ["TRANSPORT", "400.0000"]]);
    expect([e.housingAllowance, e.otherAllowances]).toEqual(["1500.0000", "400.0000"]);

    const edited = await employees.update(e.id, { allowances: [{ allowanceTypeId: transport.id, amount: "450" }] }, actor, cid());
    expect(edited!.allowances.map((a) => [a.code, a.amount])).toEqual([["TRANSPORT", "450.0000"]]);
    expect(edited!.housingAllowance).toBe("0.0000");
    expect((await employees.update(e.id, { name: "Renamed" }, actor, cid()))!.allowances).toHaveLength(1); // not given = kept

    expect(await failsWith(employees.update(e.id, { allowances: [{ allowanceTypeId: foreign.id, amount: "10" }] }, actor, cid()))).toBe("ALLOWANCE_TYPE_NOT_FOUND");
    expect(await failsWith(employees.update(e.id, { allowances: [{ allowanceTypeId: transport.id, amount: "1" }, { allowanceTypeId: transport.id, amount: "2" }] }, actor, cid()))).toBe("DUPLICATE_ALLOWANCE");
    expect((await prisma.employeeAllowance.count({ where: { employeeId: e.id } }))).toBe(1); // a refused edit changed nothing
    expect(await prisma.allowanceType.count({ where: { companyId } })).toBe(2);
  });

  it("will not stop a type an active employee is paid, and will not offer a stopped type to anyone new", async () => {
    const { actor } = await company();
    const phone = await types.create({ code: "PHONE", name: "Phone" }, actor, cid());
    const e = await hire(actor, [{ allowanceTypeId: phone.id, amount: "100" }]);
    expect(await failsWith(types.update(phone.id, { isActive: false }, actor, cid()))).toBe("IN_USE");

    await employees.update(e.id, { allowances: [] }, actor, cid());
    expect((await types.update(phone.id, { isActive: false }, actor, cid())).isActive).toBe(false);
    expect(await failsWith(hire(actor, [{ allowanceTypeId: phone.id, amount: "100" }]))).toBe("ALLOWANCE_TYPE_INACTIVE");
    expect((await types.list(actor.companyId)).some((t) => t.code === "PHONE")).toBe(false);
    expect((await types.list(actor.companyId, true)).some((t) => t.code === "PHONE")).toBe(true);
  });

  it("computes GOSI only on the types flagged for it, and gives the same result as before for housing", async () => {
    const { actor } = await company();
    const housing = await types.create({ code: "HOUSING", name: "Housing", isHousing: true, inGosiBase: true }, actor, cid());
    const transport = await types.create({ code: "TRANSPORT", name: "Transport" }, actor, cid());
    const commission = await types.create({ code: "COMM", name: "Fixed commission", inGosiBase: true }, actor, cid());

    // Basic 6000 + housing 1500 = 7500 -> the figures the original payroll test confirms (employee 825, employer 975).
    const plain = await hire(actor, [{ allowanceTypeId: housing.id, amount: "1500" }, { allowanceTypeId: transport.id, amount: "800" }]);
    const withCommission = await hire(actor, [{ allowanceTypeId: housing.id, amount: "1500" }, { allowanceTypeId: commission.id, amount: "500" }]);
    const run = await payrollRuns.create({ periodYear: 2026, periodMonth: 10, runDate: day }, actor, cid(), newId());
    const line = (id: string) => run.lines.find((l) => l.employeeId === id)!;

    expect(line(plain.id)).toMatchObject({ gosiEmployeeShare: "825.0000", gosiEmployerShare: "975.0000", gross: "8300.0000", housingAllowance: "1500.0000", otherAllowances: "800.0000" });
    // base 8000 (a flagged commission counts): 20% pension -> 800 each side, SANED 80 each, hazards 160 employer
    expect(line(withCommission.id)).toMatchObject({ gosiEmployeeShare: "880.0000", gosiEmployerShare: "1040.0000", gross: "8000.0000" });
  });

  it("snapshots the allowances on the run, so changing a type or an employee later changes nothing", async () => {
    const { actor } = await company();
    const housing = await types.create({ code: "HOUSING", name: "Housing", isHousing: true, inGosiBase: true }, actor, cid());
    const food = await types.create({ code: "FOOD", name: "Food", nameAr: "طعام" }, actor, cid());
    const e = await hire(actor, [{ allowanceTypeId: housing.id, amount: "1000" }, { allowanceTypeId: food.id, amount: "300" }]);
    const run = await payrollRuns.create({ periodYear: 2026, periodMonth: 9, runDate: new Date(Date.UTC(2026, 8, 28)) }, actor, cid(), newId());

    await types.update(food.id, { name: "Meals", inGosiBase: true }, actor, cid());
    await employees.update(e.id, { allowances: [] }, actor, cid());

    const detail = await payrollRuns.get(run.id, actor.companyId);
    expect(detail!.lines[0]!.allowances.map((a) => [a.name, a.amount, a.isHousing])).toEqual([["Food", "300.0000", false], ["Housing", "1000.0000", true]]);
    expect(detail!.lines[0]).toMatchObject({ housingAllowance: "1000.0000", otherAllowances: "300.0000", gross: "7300.0000" });
    expect(await prisma.payrollRunLineAllowance.count({ where: { companyId: actor.companyId } })).toBe(2);
  });

  it("computes the end-of-service base from the types flagged for it", async () => {
    const { actor } = await company();
    const housing = await types.create({ code: "HOUSING", name: "Housing", isHousing: true, inGosiBase: true, inEosbBase: true }, actor, cid());
    const bonus = await types.create({ code: "BONUS", name: "Fixed bonus", inEosbBase: false }, actor, cid());
    const a = await hire(actor, [{ allowanceTypeId: housing.id, amount: "2000" }]);
    const b = await hire(actor, [{ allowanceTypeId: housing.id, amount: "2000" }, { allowanceTypeId: bonus.id, amount: "3000" }]);

    const settleA = await endOfService.settle({ employeeId: a.id, terminationDate: day, reason: "TERMINATION" }, actor, cid(), newId());
    const settleB = await endOfService.settle({ employeeId: b.id, terminationDate: day, reason: "TERMINATION" }, actor, cid(), newId());
    expect(settleB.netEntitlement).toBe(settleA.netEntitlement); // the bonus is outside the base, so the gratuity is identical
  });
});
