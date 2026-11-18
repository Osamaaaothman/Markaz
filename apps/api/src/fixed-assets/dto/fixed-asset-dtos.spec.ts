import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateAssetCategoryDto, DepreciationPeriodDto, DisposeAssetDto, FixedAssetDetailsDto, OpeningAssetDto } from "./fixed-asset-dtos.js";

async function fieldsWithErrors<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property).sort();
}

const asset = { name: "Van", categoryId: "c1", acquisitionDate: "2026-01-01", inServiceDate: "2026-01-02", acquisitionCost: "12000" };

describe("fixed asset DTOs", () => {
  it("accepts a draft asset and refuses a zero or float-looking cost", async () => {
    expect(await fieldsWithErrors(FixedAssetDetailsDto, asset)).toEqual([]);
    expect(await fieldsWithErrors(FixedAssetDetailsDto, { ...asset, acquisitionCost: "0" })).toEqual(["acquisitionCost"]);
    expect(await fieldsWithErrors(FixedAssetDetailsDto, { ...asset, acquisitionCost: "1.23456" })).toEqual(["acquisitionCost"]);
    expect(await fieldsWithErrors(FixedAssetDetailsDto, { ...asset, acquisitionDate: "2026-02-30" })).toEqual(["acquisitionDate"]);
  });

  it("needs opening depreciation and its date for an opening asset", async () => {
    expect(await fieldsWithErrors(OpeningAssetDto, { ...asset, openingAccumulatedDepreciation: "100", openingAsOfDate: "2026-01-01" })).toEqual([]);
    expect(await fieldsWithErrors(OpeningAssetDto, asset)).toEqual(["openingAccumulatedDepreciation", "openingAsOfDate"]);
  });

  it("validates category code, prefix and life", async () => {
    const category = { code: "VEH", name: "Vehicles", numberPrefix: "VEH", isDepreciable: true, defaultUsefulLifeMonths: 60, assetAccountId: "a1" };
    expect(await fieldsWithErrors(CreateAssetCategoryDto, category)).toEqual([]);
    expect(await fieldsWithErrors(CreateAssetCategoryDto, { ...category, numberPrefix: "VE-H" })).toEqual(["numberPrefix"]);
    expect(await fieldsWithErrors(CreateAssetCategoryDto, { ...category, defaultUsefulLifeMonths: 0 })).toEqual(["defaultUsefulLifeMonths"]);
  });

  it("validates a run month and a disposal", async () => {
    expect(await fieldsWithErrors(DepreciationPeriodDto, { periodYear: 2026, periodMonth: 13 })).toEqual(["periodMonth"]);
    expect(await fieldsWithErrors(DisposeAssetDto, { disposalDate: "2026-03-01", disposalType: "SALE", reason: "x" })).toEqual(["disposalType"]);
    expect(await fieldsWithErrors(DisposeAssetDto, { disposalDate: "2026-03-01", disposalType: "SCRAP", reason: "" })).toEqual(["reason"]);
  });
});
