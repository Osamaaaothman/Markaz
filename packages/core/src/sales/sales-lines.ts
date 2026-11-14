import { Prisma } from "@erp/db";
import type { TransactionClient } from "../contracts.js";
import { expenseLineMath } from "../purchasing/supplier-invoice.util.js";

export class SalesError extends Error {
  constructor(
    readonly code:
      | "INVALID_RETURN"
      | "OVER_RETURN"
      | "EMPTY_DOCUMENT"
      | "CUSTOMER_NOT_FOUND"
      | "ITEM_NOT_FOUND"
      | "TAX_CODE_NOT_FOUND"
      | "DESCRIPTION_REQUIRED"
      | "NOT_FOUND"
      | "INVALID_STATE"
      | "WAREHOUSE_REQUIRED"
      | "WAREHOUSE_NOT_FOUND"
      | "INSUFFICIENT_STOCK"
      | "ORDER_LINE_NOT_FOUND"
      | "ORDER_LINE_MISMATCH"
      | "OVER_INVOICED"
      | "CUSTOMER_MISMATCH"
      | "ACCOUNT_NOT_FOUND"
      | "ACCOUNT_NOT_POSTABLE"
      | "CREDIT_EXCEEDS_INVOICE"
      | "DEBIT_EXCEEDS_INVOICE"
      | "NOT_AN_INVOICE"
      | "NO_OPEN_PERIOD"
      | "ZERO_DOCUMENT"
      | "EGS_UNIT_NOT_FOUND"
      | "EGS_UNIT_REQUIRED"
      | "BELOW_COST",
    message: string,
    readonly lineNumber?: number,
  ) {
    super(message);
    this.name = "SalesError";
  }
}

// Quotes/orders have no dispatch warehouse yet: use the company's positive stock pool.
// A missing cost is unknown, not a reason to prevent an offer or invent a selling price.
export async function assertSellingPrices(
  tx: TransactionClient, companyId: string, lines: readonly ResolvedSalesLine[],
): Promise<void> {
  const itemIds = [...new Set(lines.flatMap((line) => line.itemId ? [line.itemId] : []))];
  const stocks = await tx.itemWarehouseStock.groupBy({
    by: ["itemId"], where: { companyId, itemId: { in: itemIds }, quantity: { gt: 0 } },
    _sum: { quantity: true, value: true },
  });
  const byItem = new Map(stocks.map((stock) => [stock.itemId, stock._sum]));
  const historical = await tx.itemWarehouseStock.findMany({
    where: { companyId, itemId: { in: itemIds }, lastUnitCost: { not: null } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { itemId: true, lastUnitCost: true },
  });
  for (const line of lines) {
    const stock = line.itemId ? byItem.get(line.itemId) : undefined;
    const referenceCost = stock?.quantity?.greaterThan(0) && stock.value ? stock.value.div(stock.quantity)
      : historical.find((row) => row.itemId === line.itemId)?.lastUnitCost;
    if (referenceCost && line.unitPrice.lessThan(referenceCost)) {
      throw new SalesError("BELOW_COST", "Selling price is below the current weighted-average cost", line.lineNumber);
    }
  }
}

export interface SalesLineInput {
  readonly itemId?: string | undefined;
  // Required for a service line; an item line defaults to the item's name.
  readonly description?: string | undefined;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly taxCodeId: string;
}

export interface ResolvedSalesLine {
  readonly itemId: string | null;
  readonly description: string;
  readonly quantity: Prisma.Decimal;
  readonly unitPrice: Prisma.Decimal;
  readonly taxCodeId: string;
  readonly taxRate: Prisma.Decimal;
  readonly net: Prisma.Decimal;
  readonly tax: Prisma.Decimal;
  readonly lineNumber: number;
}

export interface SalesTotals {
  readonly net: Prisma.Decimal;
  readonly tax: Prisma.Decimal;
  readonly gross: Prisma.Decimal;
}

export function totalsOf(lines: readonly { net: Prisma.Decimal; tax: Prisma.Decimal }[]): SalesTotals {
  const net = lines.reduce((sum, l) => sum.plus(l.net), new Prisma.Decimal(0));
  const tax = lines.reduce((sum, l) => sum.plus(l.tax), new Prisma.Decimal(0));
  return { net, tax, gross: net.plus(tax) };
}

export const blankToNull = (v: string | null | undefined): string | null => (v?.trim() ? v.trim() : null);
export const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

// Looks up the items and tax codes a document's lines name and does each line's arithmetic, so a
// quotation, an order and an invoice all price a line the same way (docs/04 §2: rounded once, to
// the NUMERIC(19,4) scale, in one place).
export async function resolveSalesLines(
  tx: TransactionClient,
  companyId: string,
  lines: readonly SalesLineInput[],
): Promise<ResolvedSalesLine[]> {
  if (lines.length === 0) throw new SalesError("EMPTY_DOCUMENT", "A document needs at least one line");

  const itemIds = [...new Set(lines.flatMap((l) => (l.itemId ? [l.itemId] : [])))];
  const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId, isActive: true } });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const taxIds = [...new Set(lines.map((l) => l.taxCodeId))];
  const taxCodes = await tx.taxCode.findMany({ where: { id: { in: taxIds }, companyId, isActive: true } });
  const taxById = new Map(taxCodes.map((t) => [t.id, t]));

  return lines.map((line, index) => {
    const lineNumber = index + 1;
    const item = line.itemId ? itemById.get(line.itemId) : undefined;
    if (line.itemId && !item) throw new SalesError("ITEM_NOT_FOUND", "An item on the document was not found", lineNumber);
    const taxCode = taxById.get(line.taxCodeId);
    if (!taxCode) throw new SalesError("TAX_CODE_NOT_FOUND", "A tax code on the document was not found or is inactive", lineNumber);
    const description = blankToNull(line.description) ?? item?.name;
    if (!description) throw new SalesError("DESCRIPTION_REQUIRED", "A line with no item needs a description", lineNumber);

    const quantity = new Prisma.Decimal(line.quantity);
    const unitPrice = new Prisma.Decimal(line.unitPrice);
    const math = expenseLineMath(quantity, unitPrice, taxCode.rate);
    return {
      itemId: item?.id ?? null,
      description,
      quantity,
      unitPrice,
      taxCodeId: taxCode.id,
      taxRate: taxCode.rate,
      net: math.net,
      tax: math.tax,
      lineNumber,
    };
  });
}

export async function lockCustomer(tx: TransactionClient, companyId: string, customerId: string): Promise<void> {
  // Posted sales documents are insert-only, so they cannot be row-locked themselves; the customer's
  // party row (which the runtime role may update) serializes concurrent documents for that customer
  // — what keeps "credits never exceed the invoice" true under a race.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM parties WHERE id = ${customerId} AND company_id = ${companyId} AND is_active = true FOR UPDATE
  `;
  if (rows.length === 0) throw new SalesError("CUSTOMER_NOT_FOUND", "Customer not found");
}

// Which ZATCA issuing unit (EGS) a sales document belongs to (docs/01-OPEN-DECISIONS.md). A company
// with no active units yet is unaffected (ordinary invoicing continues; the compliance pack has
// nothing to submit until a real unit exists). Exactly one active unit is assigned automatically.
// More than one requires an explicit choice -- never guessed, since it decides which legal entity's
// certificate signs the document.
export async function resolveEgsUnitId(tx: TransactionClient, companyId: string, egsUnitId: string | undefined): Promise<string | null> {
  if (egsUnitId) {
    const unit = await tx.egsUnit.findFirst({ where: { id: egsUnitId, companyId, isActive: true } });
    if (!unit) throw new SalesError("EGS_UNIT_NOT_FOUND", "The chosen ZATCA issuing unit was not found or is not active");
    return unit.id;
  }
  const active = await tx.egsUnit.findMany({ where: { companyId, isActive: true }, select: { id: true } });
  if (active.length === 0) return null;
  if (active.length === 1) return active[0]!.id;
  throw new SalesError("EGS_UNIT_REQUIRED", "This company has more than one active ZATCA issuing unit; choose which one issues this document");
}
