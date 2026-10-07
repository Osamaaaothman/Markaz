import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateGoodsReceiptDto } from "./create-goods-receipt.dto.js";
import { CreateItemDto } from "./create-item.dto.js";
import { CreateStockIssueDto } from "./create-stock-issue.dto.js";
import { CreateWarehouseDto } from "./create-warehouse.dto.js";
import { ItemsQueryDto } from "./items-query.dto.js";
import { RecordStockCountDto } from "./record-stock-count.dto.js";
import { SetAccountMappingDto } from "./set-account-mapping.dto.js";
import { StockLevelsQueryDto } from "./stock-levels-query.dto.js";
import { UpdateItemDto } from "./update-item.dto.js";
import { UpdateWarehouseDto } from "./update-warehouse.dto.js";
import { WarehousesQueryDto } from "./warehouses-query.dto.js";

async function fieldsWithErrors<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property).sort();
}

describe("warehouse DTOs", () => {
  it("accepts a code and a bilingual name", async () => {
    expect(await fieldsWithErrors(CreateWarehouseDto, { code: "WH1", name: "Main", nameAr: "الرئيسي" })).toEqual([]);
  });

  it("rejects a missing code or name", async () => {
    expect(await fieldsWithErrors(CreateWarehouseDto, { name: "Main" })).toEqual(["code"]);
    expect(await fieldsWithErrors(CreateWarehouseDto, { code: "WH1", name: "" })).toEqual(["name"]);
  });

  it("lets an update clear the Arabic name with null and deactivate", async () => {
    expect(await fieldsWithErrors(UpdateWarehouseDto, { nameAr: null, isActive: false })).toEqual([]);
    expect(await fieldsWithErrors(UpdateWarehouseDto, { name: "" })).toEqual(["name"]);
  });

  it("whitelists the list filters", async () => {
    expect(await fieldsWithErrors(WarehousesQueryDto, { q: "main", includeInactive: "true" })).toEqual([]);
    expect(await fieldsWithErrors(WarehousesQueryDto, { includeInactive: "maybe" })).toEqual(["includeInactive"]);
    expect(await fieldsWithErrors(WarehousesQueryDto, { companyId: "other" })).toEqual(["companyId"]);
  });
});

describe("item DTOs", () => {
  it("accepts a code, name and unit, reorder point optional", async () => {
    expect(await fieldsWithErrors(CreateItemDto, { code: "ITM1", name: "Widget", unit: "EA" })).toEqual([]);
    expect(await fieldsWithErrors(CreateItemDto, { code: "ITM1", name: "Widget", unit: "EA", reorderPoint: "10" })).toEqual([]);
  });

  it("rejects a missing code, name or unit", async () => {
    expect(await fieldsWithErrors(CreateItemDto, { name: "Widget", unit: "EA" })).toEqual(["code"]);
    expect(await fieldsWithErrors(CreateItemDto, { code: "ITM1", unit: "EA" })).toEqual(["name"]);
    expect(await fieldsWithErrors(CreateItemDto, { code: "ITM1", name: "Widget" })).toEqual(["unit"]);
  });

  it("lets an update change the reorder point and deactivate", async () => {
    expect(await fieldsWithErrors(UpdateItemDto, { reorderPoint: "5", isActive: false })).toEqual([]);
  });

  it("whitelists the list filters", async () => {
    expect(await fieldsWithErrors(ItemsQueryDto, { q: "widget" })).toEqual([]);
    expect(await fieldsWithErrors(ItemsQueryDto, { companyId: "other" })).toEqual(["companyId"]);
  });
});

describe("stock DTOs", () => {
  it("whitelists the stock-levels filters", async () => {
    expect(await fieldsWithErrors(StockLevelsQueryDto, { warehouseId: "w1", itemId: "i1", belowReorderOnly: "true" })).toEqual([]);
    expect(await fieldsWithErrors(StockLevelsQueryDto, { belowReorderOnly: "maybe" })).toEqual(["belowReorderOnly"]);
  });

  it("requires an account id for the mapping", async () => {
    expect(await fieldsWithErrors(SetAccountMappingDto, { accountId: "a1" })).toEqual([]);
    expect(await fieldsWithErrors(SetAccountMappingDto, {})).toEqual(["accountId"]);
  });
});

describe("goods receipt DTO", () => {
  const validLine = { itemId: "i1", quantity: "10", unitCost: "100" };

  it("accepts a receipt with one or more lines", async () => {
    expect(
      await fieldsWithErrors(CreateGoodsReceiptDto, { warehouseId: "w1", documentDate: "2026-01-01", lines: [validLine] }),
    ).toEqual([]);
  });

  it("rejects an empty line list and an invalid date", async () => {
    expect(await fieldsWithErrors(CreateGoodsReceiptDto, { warehouseId: "w1", documentDate: "2026-01-01", lines: [] })).toEqual(["lines"]);
    expect(await fieldsWithErrors(CreateGoodsReceiptDto, { warehouseId: "w1", documentDate: "not-a-date", lines: [validLine] })).toEqual([
      "documentDate",
    ]);
  });

  it("validates each nested line", async () => {
    expect(
      await fieldsWithErrors(CreateGoodsReceiptDto, { warehouseId: "w1", documentDate: "2026-01-01", lines: [{ itemId: "i1" }] }),
    ).toEqual(["lines"]);
  });
});

describe("stock issue DTO", () => {
  it("accepts an issue with a cost-centre reference and at least one line", async () => {
    expect(
      await fieldsWithErrors(CreateStockIssueDto, {
        warehouseId: "w1",
        costCenterRef: "Project A",
        documentDate: "2026-01-01",
        lines: [{ itemId: "i1", quantity: "5" }],
      }),
    ).toEqual([]);
  });

  it("rejects a missing cost-centre reference", async () => {
    expect(
      await fieldsWithErrors(CreateStockIssueDto, {
        warehouseId: "w1",
        documentDate: "2026-01-01",
        lines: [{ itemId: "i1", quantity: "5" }],
      }),
    ).toEqual(["costCenterRef"]);
  });
});

describe("stock count DTO", () => {
  it("accepts a count line with and without the no-stock cost override", async () => {
    expect(
      await fieldsWithErrors(RecordStockCountDto, {
        warehouseId: "w1",
        documentDate: "2026-01-01",
        lines: [{ itemId: "i1", countedQuantity: "4" }],
      }),
    ).toEqual([]);
    expect(
      await fieldsWithErrors(RecordStockCountDto, {
        warehouseId: "w1",
        documentDate: "2026-01-01",
        lines: [{ itemId: "i1", countedQuantity: "4", unitCostIfNoStock: "25" }],
      }),
    ).toEqual([]);
  });
});

describe("decimal fields", () => {
  it("rejects non-numeric, negative and over-precise quantities and costs", async () => {
    const receipt = (line: object) => fieldsWithErrors(CreateGoodsReceiptDto, { warehouseId: "w1", documentDate: "2026-01-01", lines: [line] });
    expect(await receipt({ itemId: "i1", quantity: "abc", unitCost: "1" })).toEqual(["lines"]);
    expect(await receipt({ itemId: "i1", quantity: "0", unitCost: "1" })).toEqual(["lines"]);
    expect(await receipt({ itemId: "i1", quantity: "-5", unitCost: "1" })).toEqual(["lines"]);
    expect(await receipt({ itemId: "i1", quantity: "1", unitCost: "1.23456" })).toEqual(["lines"]);
    expect(await receipt({ itemId: "i1", quantity: "1.5", unitCost: "0" })).toEqual([]);
  });

  it("rejects a bad reorder point and a bad counted quantity", async () => {
    expect(await fieldsWithErrors(CreateItemDto, { code: "I", name: "N", unit: "EA", reorderPoint: "-1" })).toEqual(["reorderPoint"]);
    expect(
      await fieldsWithErrors(RecordStockCountDto, { warehouseId: "w1", documentDate: "2026-01-01", lines: [{ itemId: "i1", countedQuantity: "x" }] }),
    ).toEqual(["lines"]);
  });
});
