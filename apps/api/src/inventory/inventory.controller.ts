import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  AccountMappingError,
  AccountMappingService,
  GoodsReceiptError,
  GoodsReceiptService,
  ItemError,
  ItemService,
  StockCountError,
  StockCountService,
  StockIssueError,
  StockIssueService,
  StockLevelService,
  UnmappedAccountError,
  WarehouseError,
  WarehouseService,
  type AccountMappingEntry,
  type AccountMappingKey,
  type GoodsReceiptResult,
  type ItemListPage,
  type ItemSummary,
  type StockCountPostResult,
  type StockCountRecordResult,
  type StockCountSummary,
  type StockIssueResult,
  type StockLevelEntry,
  type WarehouseListPage,
  type WarehouseSummary,
} from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { CreateItemDto } from "./dto/create-item.dto.js";
import { CreateGoodsReceiptDto } from "./dto/create-goods-receipt.dto.js";
import { CreateStockIssueDto } from "./dto/create-stock-issue.dto.js";
import { CreateWarehouseDto } from "./dto/create-warehouse.dto.js";
import { ItemsQueryDto } from "./dto/items-query.dto.js";
import { RecordStockCountDto } from "./dto/record-stock-count.dto.js";
import { SetAccountMappingDto } from "./dto/set-account-mapping.dto.js";
import { StockCountsQueryDto } from "./dto/stock-counts-query.dto.js";
import { StockLevelsExportQueryDto } from "./dto/stock-levels-export-query.dto.js";
import { StockLevelsQueryDto } from "./dto/stock-levels-query.dto.js";
import { InventoryExportService } from "./inventory-export.service.js";
import { UpdateItemDto } from "./dto/update-item.dto.js";
import { UpdateWarehouseDto } from "./dto/update-warehouse.dto.js";
import { WarehousesQueryDto } from "./dto/warehouses-query.dto.js";

@Controller("v1")
export class InventoryController {
  constructor(
    private readonly warehouses: WarehouseService,
    private readonly items: ItemService,
    private readonly accountMappings: AccountMappingService,
    private readonly stockLevels: StockLevelService,
    private readonly goodsReceipts: GoodsReceiptService,
    private readonly stockIssues: StockIssueService,
    private readonly stockCounts: StockCountService,
    private readonly exports: InventoryExportService,
  ) {}

  // ── Warehouses ──────────────────────────────────────────────────────────────

  @Get("warehouses")
  @RequirePermission("warehouse", "read")
  listWarehouses(@CurrentUser() actor: CurrentUserPayload, @Query() query: WarehousesQueryDto): Promise<WarehouseListPage> {
    return this.warehouses.list(actor.companyId, query);
  }

  @Post("warehouses")
  @RequirePermission("warehouse", "create")
  createWarehouse(
    @Body() dto: CreateWarehouseDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<WarehouseSummary> {
    return this.mapWarehouseErrors(this.warehouses.create(dto, actor, correlationId));
  }

  @Patch("warehouses/:id")
  @RequirePermission("warehouse", "update")
  updateWarehouse(
    @Param("id") id: string,
    @Body() dto: UpdateWarehouseDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<WarehouseSummary> {
    return this.mapWarehouseErrors(this.warehouses.update(id, dto, actor, correlationId));
  }

  private async mapWarehouseErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (!(error instanceof WarehouseError)) throw error;
      switch (error.code) {
        case "DUPLICATE_CODE":
          throw new ConflictException(error.message);
        case "WAREHOUSE_NOT_FOUND":
          throw new NotFoundException(error.message);
      }
    }
  }

  // ── Items ───────────────────────────────────────────────────────────────────

  @Get("items")
  @RequirePermission("item", "read")
  listItems(@CurrentUser() actor: CurrentUserPayload, @Query() query: ItemsQueryDto): Promise<ItemListPage> {
    return this.items.list(actor.companyId, query);
  }

  @Post("items")
  @RequirePermission("item", "create")
  createItem(@Body() dto: CreateItemDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<ItemSummary> {
    return this.mapItemErrors(this.items.create(dto, actor, correlationId));
  }

  @Patch("items/:id")
  @RequirePermission("item", "update")
  updateItem(
    @Param("id") id: string,
    @Body() dto: UpdateItemDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<ItemSummary> {
    return this.mapItemErrors(this.items.update(id, dto, actor, correlationId));
  }

  private async mapItemErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (!(error instanceof ItemError)) throw error;
      switch (error.code) {
        case "DUPLICATE_CODE":
          throw new ConflictException(error.message);
        case "ITEM_NOT_FOUND":
          throw new NotFoundException(error.message);
      }
    }
  }

  // ── Stock levels (read-only) ───────────────────────────────────────────────

  @Get("stock-levels")
  @RequirePermission("stock", "read")
  listStockLevels(@CurrentUser() actor: CurrentUserPayload, @Query() query: StockLevelsQueryDto): Promise<StockLevelEntry[]> {
    return this.stockLevels.list(actor.companyId, query);
  }

  @Get("stock-levels/export")
  @RequirePermission("stock", "read")
  async exportStockLevels(
    @CurrentUser() actor: CurrentUserPayload,
    @Query() query: StockLevelsExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const { format, lang, ...filters } = query;
    const file = await this.exports.exportStockLevels(actor.companyId, filters, format, lang ?? "en");
    res.header("Content-Type", file.contentType);
    res.header("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.content);
  }

  // ── Account mapping (tenant config: which account each posting key lands in) ─

  @Get("account-mappings")
  @RequirePermission("account_mapping", "read")
  listAccountMappings(@CurrentUser() actor: CurrentUserPayload): Promise<AccountMappingEntry[]> {
    return this.accountMappings.list(actor.companyId);
  }

  @Put("account-mappings/:key")
  @RequirePermission("account_mapping", "update")
  setAccountMapping(
    @Param("key") key: string,
    @Body() dto: SetAccountMappingDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<AccountMappingEntry> {
    return this.mapAccountMappingErrors(
      this.accountMappings.set(key as AccountMappingKey, dto.accountId, actor, correlationId),
    );
  }

  private async mapAccountMappingErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (!(error instanceof AccountMappingError)) throw error;
      switch (error.code) {
        case "ACCOUNT_NOT_FOUND":
          throw new NotFoundException(error.message);
        case "ACCOUNT_NOT_POSTABLE":
          throw new BadRequestException(error.message);
      }
    }
  }

  // ── Goods receipts ──────────────────────────────────────────────────────────

  @Post("goods-receipts")
  @RequirePermission("goods_receipt", "create")
  createGoodsReceipt(
    @Body() dto: CreateGoodsReceiptDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<GoodsReceiptResult> {
    return this.mapGoodsReceiptErrors(
      this.goodsReceipts.create(
        {
          warehouseId: dto.warehouseId,
          ...(dto.partyId !== undefined ? { partyId: dto.partyId } : {}),
          documentDate: new Date(dto.documentDate),
          ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
          lines: dto.lines,
        },
        actor,
        correlationId,
        idempotencyKey,
      ),
    );
  }

  private async mapGoodsReceiptErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof UnmappedAccountError) throw new BadRequestException(error.message);
      if (!(error instanceof GoodsReceiptError)) throw error;
      switch (error.code) {
        case "WAREHOUSE_NOT_FOUND":
        case "ITEM_NOT_FOUND":
          throw new NotFoundException(error.message);
        case "NO_OPEN_PERIOD":
        case "EMPTY_RECEIPT":
          throw new BadRequestException(error.message);
      }
    }
  }

  // ── Stock issues ────────────────────────────────────────────────────────────

  @Post("stock-issues")
  @RequirePermission("stock_issue", "create")
  createStockIssue(
    @Body() dto: CreateStockIssueDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<StockIssueResult> {
    return this.mapStockIssueErrors(
      this.stockIssues.create(
        {
          warehouseId: dto.warehouseId,
          costCenterRef: dto.costCenterRef,
          documentDate: new Date(dto.documentDate),
          lines: dto.lines,
        },
        actor,
        correlationId,
        idempotencyKey,
      ),
    );
  }

  private async mapStockIssueErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof UnmappedAccountError) throw new BadRequestException(error.message);
      if (!(error instanceof StockIssueError)) throw error;
      switch (error.code) {
        case "WAREHOUSE_NOT_FOUND":
        case "ITEM_NOT_FOUND":
          throw new NotFoundException(error.message);
        case "NO_OPEN_PERIOD":
        case "EMPTY_ISSUE":
        case "INSUFFICIENT_STOCK":
          throw new BadRequestException(error.message);
      }
    }
  }

  // ── Stock counts (recorded as a draft, posted as a separate step) ──────────

  @Get("stock-counts")
  @RequirePermission("stock_count", "read")
  listStockCounts(@CurrentUser() actor: CurrentUserPayload, @Query() query: StockCountsQueryDto): Promise<StockCountSummary[]> {
    return this.stockCounts.list(actor.companyId, query);
  }

  @Post("stock-counts")
  @RequirePermission("stock_count", "create")
  recordStockCount(
    @Body() dto: RecordStockCountDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<StockCountRecordResult> {
    return this.mapStockCountErrors(
      this.stockCounts.record(
        { warehouseId: dto.warehouseId, documentDate: new Date(dto.documentDate), lines: dto.lines },
        actor,
        correlationId,
      ),
    );
  }

  @Post("stock-counts/:id/post")
  @RequirePermission("stock_count", "post")
  postStockCount(
    @Param("id") id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<StockCountPostResult> {
    return this.mapStockCountErrors(this.stockCounts.post(id, actor, correlationId, idempotencyKey));
  }

  private async mapStockCountErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof UnmappedAccountError) throw new BadRequestException(error.message);
      if (!(error instanceof StockCountError)) throw error;
      switch (error.code) {
        case "WAREHOUSE_NOT_FOUND":
        case "ITEM_NOT_FOUND":
        case "COUNT_NOT_FOUND":
          throw new NotFoundException(error.message);
        case "EMPTY_COUNT":
        case "UNIT_COST_REQUIRED":
        case "ALREADY_POSTED":
        case "NO_OPEN_PERIOD":
          throw new BadRequestException(error.message);
      }
    }
  }
}
