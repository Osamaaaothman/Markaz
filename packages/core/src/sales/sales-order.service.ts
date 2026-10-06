import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger, TransactionClient } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { allocateDocumentNumber } from "../reference.js";
import { lockOpenQuotation, type SalesActor, type SalesLineView } from "./quotation.service.js";
import { SalesError, blankToNull, dateOnly, lockCustomer, resolveSalesLines, totalsOf, type SalesLineInput } from "./sales-lines.js";

export type SalesOrderStatus = "OPEN" | "PARTIALLY_INVOICED" | "INVOICED" | "CANCELLED";

export interface CreateSalesOrderInput {
  readonly customerId: string;
  readonly orderDate: Date;
  readonly notes?: string | undefined;
  readonly lines: readonly SalesLineInput[];
}

export interface SalesOrderSummary {
  readonly id: string;
  readonly number: string;
  readonly status: SalesOrderStatus;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNameAr: string | null;
  readonly orderDate: string;
  readonly currency: string;
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
}

export interface SalesOrderDetail extends SalesOrderSummary {
  readonly notes: string | null;
  readonly lines: readonly SalesLineView[];
}

export interface SalesOrderListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly status?: SalesOrderStatus | undefined;
  readonly customerId?: string | undefined;
}

export interface SalesOrderListPage {
  readonly data: readonly SalesOrderSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface SalesOrderCreated {
  readonly id: string;
  readonly number: string;
  readonly status: SalesOrderStatus;
}

type OrderRow = Prisma.SalesOrderGetPayload<{ include: { customer: true } }>;

function toSummary(row: OrderRow): SalesOrderSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status as SalesOrderStatus,
    customerId: row.customerId,
    customerName: row.customer.name,
    customerNameAr: row.customer.nameAr,
    orderDate: dateOnly(row.orderDate),
    currency: row.currency,
    totalNet: row.totalNet.toFixed(4),
    totalTax: row.totalTax.toFixed(4),
    totalGross: row.totalGross.toFixed(4),
  };
}

// A confirmed order. Like a quotation it moves nothing in stock or the ledger; it fixes what was
// agreed and tracks how much of it has been invoiced (the invoice service moves the counters).
export class SalesOrderService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async create(input: CreateSalesOrderInput, actor: SalesActor, correlationId: string): Promise<SalesOrderCreated> {
    const created = await this.prisma.$transaction(async (tx) => {
      await lockCustomer(tx, actor.companyId, input.customerId);
      const lines = await resolveSalesLines(tx, actor.companyId, input.lines);
      return this.insert(tx, actor, correlationId, input.customerId, input.orderDate, blankToNull(input.notes), lines);
    });
    await this.audit.log({ actorId: actor.id, action: "sales_order.created", entityType: "SalesOrder", entityId: created.id, after: { ...created }, correlationId });
    return created;
  }

  // Turns an OPEN quotation into an order with the same lines and prices, and marks it CONVERTED.
  async createFromQuotation(quotationId: string, orderDate: Date, actor: SalesActor, correlationId: string): Promise<SalesOrderCreated> {
    const created = await this.prisma.$transaction(async (tx) => {
      await lockOpenQuotation(tx, actor.companyId, quotationId);
      const quotation = await tx.quotation.findFirstOrThrow({ where: { id: quotationId, companyId: actor.companyId }, include: { lines: { orderBy: { lineNumber: "asc" } } } });
      await lockCustomer(tx, actor.companyId, quotation.customerId);
      // Re-price through the same path an order uses, so a tax code that was deactivated since the
      // quote cannot slip through.
      const lines = await resolveSalesLines(
        tx,
        actor.companyId,
        quotation.lines.map((l) => ({ itemId: l.itemId ?? undefined, description: l.description, quantity: l.quantity.toFixed(4), unitPrice: l.unitPrice.toFixed(4), taxCodeId: l.taxCodeId })),
      );
      const order = await this.insert(tx, actor, correlationId, quotation.customerId, orderDate, quotation.notes, lines);
      await tx.quotation.update({ where: { id: quotationId }, data: { status: "CONVERTED", salesOrderId: order.id } });
      return order;
    });
    await this.audit.log({ actorId: actor.id, action: "sales_order.created", entityType: "SalesOrder", entityId: created.id, after: { ...created, quotationId }, correlationId });
    return created;
  }

  private async insert(
    tx: TransactionClient,
    actor: SalesActor,
    correlationId: string,
    customerId: string,
    orderDate: Date,
    notes: string | null,
    lines: Awaited<ReturnType<typeof resolveSalesLines>>,
  ): Promise<SalesOrderCreated> {
    const totals = totalsOf(lines);
    const currency = await companyCurrency(tx, actor.companyId);
    const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, orderDate);
    const number = await allocateDocumentNumber(tx, actor.companyId, "sales_order", "SO", fiscalYear);
    const id = newId();
    await tx.salesOrder.create({
      data: {
        id,
        companyId: actor.companyId,
        number,
        customerId,
        status: "OPEN",
        orderDate,
        currency,
        totalNet: totals.net,
        totalTax: totals.tax,
        totalGross: totals.gross,
        notes,
        createdBy: actor.id,
        correlationId,
        lines: {
          create: lines.map((l) => ({
            id: newId(),
            itemId: l.itemId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxCodeId: l.taxCodeId,
            lineNumber: l.lineNumber,
          })),
        },
      },
    });
    return { id, number, status: "OPEN" };
  }

  async list(companyId: string, query: SalesOrderListQuery): Promise<SalesOrderListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.salesOrder.findMany({
      where: { companyId, ...(query.status ? { status: query.status } : {}), ...(query.customerId ? { customerId: query.customerId } : {}) },
      include: { customer: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { data: page.map(toSummary), pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null } };
  }

  async get(companyId: string, id: string): Promise<SalesOrderDetail> {
    const row = await this.prisma.salesOrder.findFirst({
      where: { id, companyId },
      include: { customer: true, lines: { orderBy: { lineNumber: "asc" }, include: { taxCode: true } } },
    });
    if (!row) throw new SalesError("NOT_FOUND", "Sales order not found");
    return {
      ...toSummary(row),
      notes: row.notes,
      lines: row.lines.map((l) => {
        const net = l.quantity.times(l.unitPrice).toDecimalPlaces(4);
        return {
          id: l.id,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity.toFixed(4),
          unitPrice: l.unitPrice.toFixed(4),
          taxCodeId: l.taxCodeId,
          taxRate: l.taxCode.rate.toFixed(4),
          netAmount: net.toFixed(4),
          taxAmount: net.times(l.taxCode.rate).div(100).toDecimalPlaces(4).toFixed(4),
          invoicedQuantity: l.invoicedQuantity.toFixed(4),
        };
      }),
    };
  }

  // Only an order nothing has been invoiced against can be cancelled.
  async cancel(id: string, actor: SalesActor, correlationId: string): Promise<SalesOrderCreated> {
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: string; number: string }[]>`
        SELECT status, number FROM sales_orders WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE
      `;
      const order = rows[0];
      if (!order) throw new SalesError("NOT_FOUND", "Sales order not found");
      if (order.status !== "OPEN") throw new SalesError("INVALID_STATE", "Only an order with nothing invoiced can be cancelled");
      await tx.salesOrder.update({ where: { id }, data: { status: "CANCELLED", version: { increment: 1 } } });
      return { id, number: order.number, status: "CANCELLED" } as const;
    });
    await this.audit.log({ actorId: actor.id, action: "sales_order.cancelled", entityType: "SalesOrder", entityId: id, after: { ...result }, correlationId });
    return result;
  }
}
