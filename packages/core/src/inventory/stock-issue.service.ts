import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "./account-mapping.service.js";
import { lockStockRow, saveStockRow } from "./stock-row.repo.js";
import { InsufficientStockError, applyIssue } from "./weighted-average.util.js";

export class StockIssueError extends Error {
  constructor(
    readonly code: "WAREHOUSE_NOT_FOUND" | "ITEM_NOT_FOUND" | "NO_OPEN_PERIOD" | "EMPTY_ISSUE" | "INSUFFICIENT_STOCK",
    message: string,
  ) {
    super(message);
    this.name = "StockIssueError";
  }
}

export interface StockIssueLineInput {
  readonly itemId: string;
  readonly quantity: string;
}

export interface CreateStockIssueInput {
  readonly warehouseId: string;
  // Free text in M4 — no formal project/cost-center table exists yet (docs/14 M4 decision).
  readonly costCenterRef: string;
  readonly documentDate: Date;
  readonly lines: readonly StockIssueLineInput[];
}

export interface StockIssueActor {
  readonly id: string;
  readonly companyId: string;
}

export interface StockIssueSummary {
  readonly id: string;
  readonly number: string;
  readonly documentDate: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly warehouseNameAr: string | null;
  readonly costCenterRef: string;
  readonly lineCount: number;
  readonly totalValue: string;
}

export interface StockIssueLineDetail {
  readonly lineNumber: number;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly itemNameAr: string | null;
  readonly unit: string;
  readonly quantity: string;
  // The weighted-average cost at the moment of posting, as stored.
  readonly unitCost: string;
  readonly value: string;
}

export interface StockIssueDetail extends StockIssueSummary {
  readonly currency: string;
  readonly journalEntryId: string;
  readonly lines: readonly StockIssueLineDetail[];
}

export interface StockIssueListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly warehouseId?: string | undefined;
}

export interface StockIssueListPage {
  readonly data: readonly StockIssueSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface StockIssueResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
}

const ISSUE_INCLUDE = {
  warehouse: { select: { name: true, nameAr: true } },
  lines: { orderBy: { lineNumber: "asc" as const }, include: { item: { select: { code: true, name: true, nameAr: true, unit: true } } } },
} as const;

type IssueRow = Prisma.StockIssueGetPayload<{ include: typeof ISSUE_INCLUDE }>;

function toIssueSummary(r: IssueRow): StockIssueSummary {
  return {
    id: r.id,
    number: r.number,
    documentDate: r.documentDate.toISOString().slice(0, 10),
    warehouseId: r.warehouseId,
    warehouseName: r.warehouse.name,
    warehouseNameAr: r.warehouse.nameAr,
    costCenterRef: r.costCenterRef,
    lineCount: r.lines.length,
    totalValue: r.lines.reduce((sum, l) => sum.plus(l.value), new Prisma.Decimal(0)).toFixed(4),
  };
}

// An issue to a project charges Direct Costs at the item's current weighted-average cost and
// credits Inventory — docs/14-MILESTONES.md M4 decision. No negative stock
// (docs/01-OPEN-DECISIONS.md A3): a line that asks for more than is on hand fails the whole
// document cleanly (InsufficientStockError), nothing is issued, nothing is posted.
export class StockIssueService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly accountMappings: AccountMappingService,
    private readonly audit: IAuditLogger,
  ) {}

  async list(companyId: string, query: StockIssueListQuery): Promise<StockIssueListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.stockIssue.findMany({
      where: { companyId, ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}) },
      include: ISSUE_INCLUDE,
      orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { data: page.map(toIssueSummary), pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null } };
  }

  async get(id: string, companyId: string): Promise<StockIssueDetail | null> {
    const row = await this.prisma.stockIssue.findFirst({ where: { id, companyId }, include: ISSUE_INCLUDE });
    if (!row) return null;
    const { defaultCurrency } = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { defaultCurrency: true } });
    return {
      ...toIssueSummary(row),
      currency: defaultCurrency,
      journalEntryId: row.journalEntryId,
      lines: row.lines.map((l) => ({
        lineNumber: l.lineNumber,
        itemId: l.itemId,
        itemCode: l.item.code,
        itemName: l.item.name,
        itemNameAr: l.item.nameAr,
        unit: l.item.unit,
        quantity: l.quantity.toFixed(4),
        unitCost: l.unitCost.toFixed(4),
        value: l.value.toFixed(4),
      })),
    };
  }

  async create(
    input: CreateStockIssueInput,
    actor: StockIssueActor,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<StockIssueResult> {
    if (input.lines.length === 0) {
      throw new StockIssueError("EMPTY_ISSUE", "A stock issue needs at least one line");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: input.warehouseId, companyId: actor.companyId, isActive: true },
        select: { id: true },
      });
      if (!warehouse) throw new StockIssueError("WAREHOUSE_NOT_FOUND", "Warehouse not found");

      const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
      const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId: actor.companyId, isActive: true } });
      const itemsById = new Map(items.map((i) => [i.id, i]));
      for (const itemId of itemIds) {
        if (!itemsById.has(itemId)) throw new StockIssueError("ITEM_NOT_FOUND", `Item ${itemId} not found`);
      }

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.documentDate);
      const currency = await companyCurrency(tx, actor.companyId);
      if (!period) throw new StockIssueError("NO_OPEN_PERIOD", "No open fiscal period covers this document date");

      const expenseAccountId = await this.accountMappings.resolve(tx, actor.companyId, "PROJECT_ISSUE_EXPENSE");
      const inventoryAccountId = await this.accountMappings.resolve(tx, actor.companyId, "INVENTORY");

      let totalValue = new Prisma.Decimal(0);
      const lineRecords: { itemId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal; value: Prisma.Decimal }[] = [];
      for (const line of input.lines) {
        const quantity = new Prisma.Decimal(line.quantity);
        const stock = await lockStockRow(tx, actor.companyId, line.itemId, input.warehouseId);
        let issued;
        try {
          issued = applyIssue(stock.state, quantity);
        } catch (error) {
          if (error instanceof InsufficientStockError) {
            throw new StockIssueError("INSUFFICIENT_STOCK", error.message);
          }
          throw error;
        }
        await saveStockRow(tx, stock.id, issued.state);

        totalValue = totalValue.plus(issued.value);
        lineRecords.push({ itemId: line.itemId, quantity, unitCost: issued.unitCost, value: issued.value });
      }

      const issueId = newId();
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: input.documentDate,
          postingDate: input.documentDate,
          currency,
          lines: [
            { accountId: expenseAccountId, debit: totalValue.toFixed(4), description: `Stock issue — ${input.costCenterRef}` },
            { accountId: inventoryAccountId, credit: totalValue.toFixed(4), description: `Stock issue — ${input.costCenterRef}` },
          ],
          sourceModule: "inventory",
          sourceDocumentType: "stock_issue",
          sourceDocumentId: issueId,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      const number = posting.number;
      await tx.stockIssue.create({
        data: {
          id: issueId,
          companyId: actor.companyId,
          number,
          warehouseId: input.warehouseId,
          costCenterRef: input.costCenterRef,
          documentDate: input.documentDate,
          journalEntryId: posting.journalEntryId,
          actorId: actor.id,
          correlationId,
          lines: {
            create: lineRecords.map((l, index) => ({
              id: newId(),
              itemId: l.itemId,
              quantity: l.quantity,
              unitCost: l.unitCost,
              value: l.value,
              lineNumber: index + 1,
            })),
          },
        },
      });

      await tx.stockMovement.createMany({
        data: lineRecords.map((l) => ({
          id: newId(),
          companyId: actor.companyId,
          itemId: l.itemId,
          warehouseId: input.warehouseId,
          movementType: "ISSUE",
          quantity: l.quantity.negated(),
          unitCost: l.unitCost,
          value: l.value,
          sourceDocumentType: "stock_issue",
          sourceDocumentId: issueId,
          journalEntryId: posting.journalEntryId,
          actorId: actor.id,
          correlationId,
        })),
      });

      return { id: issueId, number, journalEntryId: posting.journalEntryId };
    });

    await this.audit.log({
      actorId: actor.id,
      action: "stock_issue.posted",
      entityType: "StockIssue",
      entityId: result.id,
      after: result,
      correlationId,
    });

    return result;
  }
}
