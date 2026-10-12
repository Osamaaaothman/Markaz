import { defaultTrialBalancePeriod } from "./trial-balance-period.js";
import { PeriodTrialBalanceQueryDto, TrialBalanceExportQueryDto } from "./dto/trial-balance-query.dto.js";
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

describe("defaultTrialBalancePeriod", () => {
  it("uses what was asked for", () => {
    const { from, to } = defaultTrialBalancePeriod({ from: "2026-02-01", to: "2026-02-28" });
    expect(from.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(to.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("falls back to the first day of this year and today", () => {
    const { from, to } = defaultTrialBalancePeriod({});
    const now = new Date();
    expect(from.toISOString().slice(0, 10)).toBe(`${now.getUTCFullYear()}-01-01`);
    expect(to.toISOString().slice(0, 10)).toBe(now.toISOString().slice(0, 10));
  });
});

async function fieldsWithErrors<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property).sort();
}

describe("trial balance query DTOs", () => {
  it("accepts dates and refuses anything else", async () => {
    expect(await fieldsWithErrors(PeriodTrialBalanceQueryDto, { from: "2026-01-01", to: "2026-12-31" })).toEqual([]);
    expect(await fieldsWithErrors(PeriodTrialBalanceQueryDto, {})).toEqual([]);
    expect(await fieldsWithErrors(PeriodTrialBalanceQueryDto, { from: "yesterday" })).toEqual(["from"]);
    expect(await fieldsWithErrors(PeriodTrialBalanceQueryDto, { companyId: "x" })).toEqual(["companyId"]);
  });

  it("needs a format for an export", async () => {
    expect(await fieldsWithErrors(TrialBalanceExportQueryDto, { format: "pdf", from: "2026-01-01" })).toEqual([]);
    expect(await fieldsWithErrors(TrialBalanceExportQueryDto, {})).toEqual(["format"]);
    expect(await fieldsWithErrors(TrialBalanceExportQueryDto, { format: "xml" })).toEqual(["format"]);
  });
});
