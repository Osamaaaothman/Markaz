import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { StockMovementsQueryDto } from "./stock-movements-query.dto.js";
import { StockMovementsExportQueryDto } from "./stock-movements-export-query.dto.js";

async function fieldsWithErrors(plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(StockMovementsQueryDto, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property).sort();
}

describe("stock movements query", () => {
  it("accepts every filter, all optional", async () => {
    expect(await fieldsWithErrors({})).toEqual([]);
    expect(await fieldsWithErrors({ movementType: "RETURN" })).toEqual([]);
    expect(await fieldsWithErrors({ itemId: "i1", warehouseId: "w1", movementType: "ISSUE", from: "2026-01-01", to: "2026-12-31", limit: "20" })).toEqual([]);
  });

  it("validates export formats, locale and selected row without accepting company overrides", async () => {
    const check = async (input: object) => (await validate(plainToInstance(StockMovementsExportQueryDto, input), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property).sort();
    expect(await check({})).toEqual([]);
    expect(await check({ format: "pdf", lang: "ar", movementType: "RETURN", movementId: "01a1c789-9529-76b5-839c-47a486206e8a" })).toEqual([]);
    expect(await check({ format: "html", lang: "fr", movementId: "bad", companyId: "other" })).toEqual(["companyId", "format", "lang", "movementId"]);
  });

  it("rejects an unknown type and a bad date", async () => {
    expect(await fieldsWithErrors({ movementType: "STOLEN" })).toEqual(["movementType"]);
    expect(await fieldsWithErrors({ from: "yesterday" })).toEqual(["from"]);
  });
});
