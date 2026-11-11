import { Prisma, type PrismaClient } from "@erp/db";

export type MovementType = "RECEIPT" | "ISSUE" | "COUNT_ADJUSTMENT" | "RETURN";

export interface StockMovementEntry {
  readonly id: string;
  readonly date: string;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly itemNameAr: string | null;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly warehouseNameAr: string | null;
  readonly movementType: MovementType;
  // Signed: positive in (receipt, count surplus), negative out (issue, sale, count shortage).
  readonly quantity: string;
  readonly unitCost: string;
  readonly value: string;
  readonly sourceDocumentType: string;
  readonly partyName: string | null;
  readonly partyNameAr: string | null;
  // The ledger entry the movement was posted with; for the stock documents its number is the document number.
  readonly journalEntryId: string;
  readonly entryNumber: string;
}

export interface StockMovementQuery {
  readonly movementId?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly itemId?: string | undefined;
  readonly warehouseId?: string | undefined;
  readonly movementType?: MovementType | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

export interface StockMovementPage {
  readonly data: readonly StockMovementEntry[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export const STOCK_MOVEMENT_EXPORT_LIMIT = 20_000;

export class StockMovementExportLimitError extends Error {
  constructor() { super("STOCK_MOVEMENT_EXPORT_LIMIT"); }
}

type Row = Prisma.StockMovementGetPayload<{ include: { item: true; warehouse: true; journalEntry: { select: { number: true } } } }>;

type MovementParty = { name: string; nameAr: string | null };

function toEntry(row: Row, party?: MovementParty): StockMovementEntry {
  return {
    id: row.id,
    date: row.createdAt.toISOString(),
    itemId: row.itemId,
    itemCode: row.item.code,
    itemName: row.item.name,
    itemNameAr: row.item.nameAr,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    warehouseNameAr: row.warehouse.nameAr,
    movementType: row.movementType as MovementType,
    quantity: row.quantity.toFixed(4),
    unitCost: row.unitCost.toFixed(4),
    value: row.value.toFixed(4),
    sourceDocumentType: row.sourceDocumentType,
    partyName: party?.name ?? null,
    partyNameAr: party?.nameAr ?? null,
    journalEntryId: row.journalEntryId,
    entryNumber: row.journalEntry.number,
  };
}

// The stock card: every movement of every item, newest first. Read-only — movements are append-only and
// only ever written by the posting services, in the same transaction as their ledger entry.
export class StockMovementService {
  constructor(private readonly prisma: PrismaClient) {}

  // Resolve the source documents in batches, including for exports, rather than one query per movement.
  private async entries(companyId: string, rows: Row[]): Promise<StockMovementEntry[]> {
    const sourceIds = (types: readonly string[]): string[] =>
      [...new Set(rows.filter((row) => types.includes(row.sourceDocumentType)).map((row) => row.sourceDocumentId))];
    const receiptIds = sourceIds(["goods_receipt"]);
    const returnIds = sourceIds(["goods_return"]);
    const invoiceIds = sourceIds(["sales_invoice", "sales_credit_note", "sales_debit_note"]);
    const partySelect = { name: true, nameAr: true } as const;
    const [receipts, returns, invoices] = await Promise.all([
      receiptIds.length ? this.prisma.goodsReceipt.findMany({
        where: { companyId, id: { in: receiptIds }, party: { companyId } },
        select: { id: true, party: { select: partySelect } },
      }) : [],
      returnIds.length ? this.prisma.goodsReturn.findMany({
        where: { companyId, id: { in: returnIds }, party: { companyId } },
        select: { id: true, party: { select: partySelect } },
      }) : [],
      invoiceIds.length ? this.prisma.salesInvoice.findMany({
        where: { companyId, id: { in: invoiceIds }, customer: { companyId } },
        select: { id: true, documentType: true, customer: { select: partySelect } },
      }) : [],
    ]);
    const parties = new Map<string, MovementParty>();
    for (const receipt of receipts) {
      if (receipt.party) parties.set(`goods_receipt:${receipt.id}`, receipt.party);
    }
    for (const returned of returns) parties.set(`goods_return:${returned.id}`, returned.party);
    for (const invoice of invoices) {
      const type = { INVOICE: "sales_invoice", CREDIT_NOTE: "sales_credit_note", DEBIT_NOTE: "sales_debit_note" }[invoice.documentType];
      if (type) parties.set(`${type}:${invoice.id}`, invoice.customer);
    }
    return rows.map((row) => toEntry(row, parties.get(`${row.sourceDocumentType}:${row.sourceDocumentId}`)));
  }

  private where(companyId: string, query: StockMovementQuery): Prisma.StockMovementWhereInput {
    return {
      companyId,
      ...(query.movementId ? { id: query.movementId } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.movementType ? { movementType: query.movementType } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: new Date(query.to.getTime() + 86_400_000) } : {}) } }
        : {}),
    };
  }

  async list(companyId: string, query: StockMovementQuery): Promise<StockMovementPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.stockMovement.findMany({
      where: this.where(companyId, query),
      include: { item: true, warehouse: true, journalEntry: { select: { number: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { data: await this.entries(companyId, page), pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null } };
  }

  // Everything the filter matches (up to a cap), oldest first, for a file export.
  async listForExport(companyId: string, query: StockMovementQuery): Promise<StockMovementEntry[]> {
    const rows = await this.prisma.stockMovement.findMany({
      where: this.where(companyId, query),
      include: { item: true, warehouse: true, journalEntry: { select: { number: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: STOCK_MOVEMENT_EXPORT_LIMIT + 1,
    });
    if (rows.length > STOCK_MOVEMENT_EXPORT_LIMIT) throw new StockMovementExportLimitError();
    return this.entries(companyId, rows);
  }
}
