import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger, TransactionClient } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { allocateDocumentNumber } from "../reference.js";
import {
  SalesError,
  blankToNull,
  dateOnly,
  lockCustomer,
  resolveSalesLines,
  totalsOf,
  type SalesLineInput,
} from "./sales-lines.js";

export type QuotationStatus = "OPEN" | "CONVERTED" | "REJECTED" | "CANCELLED";

export interface CreateQuotationInput {
  readonly customerId: string;
  readonly quotationDate: Date;
  readonly validUntil?: Date | undefined;
  readonly notes?: string | undefined;
  readonly lines: readonly SalesLineInput[];
}

export interface SalesActor {
  readonly id: string;
  readonly companyId: string;
}

export interface SalesLineView {
  readonly id: string;
  readonly itemId: string | null;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly taxCodeId: string;
  readonly taxRate: string;
  readonly netAmount: string;
  readonly taxAmount: string;
  // Sales orders only.
  readonly invoicedQuantity?: string;
}

export interface QuotationSummary {
  readonly id: string;
  readonly number: string;
  readonly status: QuotationStatus;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNameAr: string | null;
  readonly quotationDate: string;
  readonly validUntil: string | null;
  readonly currency: string;
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
  readonly salesOrderId: string | null;
}

export interface QuotationDetail extends QuotationSummary {
  readonly notes: string | null;
  readonly lines: readonly SalesLineView[];
}

export interface QuotationListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly status?: QuotationStatus | undefined;
}

export interface QuotationListPage {
  readonly data: readonly QuotationSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

type QuotationRow = Prisma.QuotationGetPayload<{ include: { customer: true } }>;

function toSummary(row: QuotationRow): QuotationSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status as QuotationStatus,
    customerId: row.customerId,
    customerName: row.customer.name,
    customerNameAr: row.customer.nameAr,
    quotationDate: dateOnly(row.quotationDate),
    validUntil: row.validUntil ? dateOnly(row.validUntil) : null,
    currency: row.currency,
    totalNet: row.totalNet.toFixed(4),
    totalTax: row.totalTax.toFixed(4),
    totalGross: row.totalGross.toFixed(4),
    salesOrderId: row.salesOrderId,
  };
}

// An offer to a customer. Moves nothing in stock or in the ledger. OPEN until it becomes a sales
// order (SalesOrderService.createFromQuotation), is declined, or is withdrawn.
export class QuotationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async create(input: CreateQuotationInput, actor: SalesActor, correlationId: string): Promise<QuotationSummary> {
    const id = newId();
    const created = await this.prisma.$transaction(async (tx) => {
      await lockCustomer(tx, actor.companyId, input.customerId);
      const lines = await resolveSalesLines(tx, actor.companyId, input.lines);
      const totals = totalsOf(lines);
      const currency = await companyCurrency(tx, actor.companyId);
      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.quotationDate);
      const number = await allocateDocumentNumber(tx, actor.companyId, "quotation", "QUO", fiscalYear);

      return tx.quotation.create({
        data: {
          id,
          companyId: actor.companyId,
          number,
          customerId: input.customerId,
          status: "OPEN",
          quotationDate: input.quotationDate,
          validUntil: input.validUntil ?? null,
          currency,
          totalNet: totals.net,
          totalTax: totals.tax,
          totalGross: totals.gross,
          notes: blankToNull(input.notes),
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
              taxRate: l.taxRate,
              netAmount: l.net,
              taxAmount: l.tax,
              lineNumber: l.lineNumber,
            })),
          },
        },
        include: { customer: true },
      });
    });
    const summary = toSummary(created);
    await this.audit.log({ actorId: actor.id, action: "quotation.created", entityType: "Quotation", entityId: id, after: { ...summary }, correlationId });
    return summary;
  }

  async list(companyId: string, query: QuotationListQuery): Promise<QuotationListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.quotation.findMany({
      where: { companyId, ...(query.status ? { status: query.status } : {}) },
      include: { customer: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { data: page.map(toSummary), pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null } };
  }

  async get(companyId: string, id: string): Promise<QuotationDetail> {
    const row = await this.prisma.quotation.findFirst({
      where: { id, companyId },
      include: { customer: true, lines: { orderBy: { lineNumber: "asc" } } },
    });
    if (!row) throw new SalesError("NOT_FOUND", "Quotation not found");
    return {
      ...toSummary(row),
      notes: row.notes,
      lines: row.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        description: l.description,
        quantity: l.quantity.toFixed(4),
        unitPrice: l.unitPrice.toFixed(4),
        taxCodeId: l.taxCodeId,
        taxRate: l.taxRate.toFixed(4),
        netAmount: l.netAmount.toFixed(4),
        taxAmount: l.taxAmount.toFixed(4),
      })),
    };
  }

  async reject(id: string, actor: SalesActor, correlationId: string): Promise<QuotationSummary> {
    return this.close(id, "REJECTED", actor, correlationId);
  }

  async cancel(id: string, actor: SalesActor, correlationId: string): Promise<QuotationSummary> {
    return this.close(id, "CANCELLED", actor, correlationId);
  }

  private async close(id: string, status: "REJECTED" | "CANCELLED", actor: SalesActor, correlationId: string): Promise<QuotationSummary> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockOpenQuotation(tx, actor.companyId, id);
      return tx.quotation.update({ where: { id }, data: { status }, include: { customer: true } });
    });
    const summary = toSummary(updated);
    await this.audit.log({ actorId: actor.id, action: `quotation.${status.toLowerCase()}`, entityType: "Quotation", entityId: id, after: { ...summary }, correlationId });
    return summary;
  }
}

// Locks the quotation row and insists it is still OPEN — shared by close and by conversion.
export async function lockOpenQuotation(tx: TransactionClient, companyId: string, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM quotations WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new SalesError("NOT_FOUND", "Quotation not found");
  if (row.status !== "OPEN") throw new SalesError("INVALID_STATE", "This quotation is no longer open");
}
