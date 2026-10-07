import { Prisma, type PrismaClient } from "@erp/db";
import { AgingService } from "../payments/aging.service.js";

// Which parts of the dashboard this user may see. The caller sets each from the user's permissions,
// so a role without the right never gets that section's numbers (the dashboard is not a side door).
export interface DashboardSections {
  readonly receivables: boolean;
  readonly payables: boolean;
  readonly profit: boolean;
  readonly cash: boolean;
  readonly stock: boolean;
  readonly sales: boolean;
  readonly purchasing: boolean;
}

export interface AgingSummary {
  readonly total: string;
  readonly overdue: string;
}

export interface MonthlyResult {
  // "YYYY-MM"
  readonly month: string;
  readonly revenue: string;
  readonly expense: string;
}

export interface DashboardData {
  readonly asOf: string;
  readonly currency: string;
  readonly receivables?: AgingSummary;
  readonly payables?: AgingSummary;
  // Balance of the bank and cash accounts that payments have been made through; null until one exists.
  readonly cash?: { readonly balance: string | null };
  readonly monthly?: readonly MonthlyResult[];
  readonly stock?: { readonly value: string; readonly belowReorder: number };
  readonly sales?: { readonly thisMonthNet: string; readonly openQuotations: number; readonly openOrders: number };
  readonly purchasing?: { readonly pendingApprovals: number; readonly openOrders: number; readonly pendingRequests: number };
}

const MONTHS_SHOWN = 6;

// The first screen: what is owed to and by the company, how the last months went, cash, stock and what
// is waiting for someone to act. Everything here is read from the same sources as the detailed reports
// (the ageing service, the ledger), so a card can never disagree with the report behind it.
export class DashboardService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly aging: AgingService,
  ) {}

  async compute(companyId: string, sections: DashboardSections, now: Date = new Date()): Promise<DashboardData> {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { defaultCurrency: true } });
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const [receivables, payables, cash, monthly, stock, sales, purchasing] = await Promise.all([
      sections.receivables ? this.agingSummary(companyId, "SALES", today) : undefined,
      sections.payables ? this.agingSummary(companyId, "SUPPLIER", today) : undefined,
      sections.cash ? this.cash(companyId) : undefined,
      sections.profit ? this.monthly(companyId, today) : undefined,
      sections.stock ? this.stock(companyId) : undefined,
      sections.sales ? this.salesSummary(companyId, today) : undefined,
      sections.purchasing ? this.purchasingSummary(companyId) : undefined,
    ]);

    return {
      asOf: today.toISOString().slice(0, 10),
      currency: company.defaultCurrency,
      ...(receivables ? { receivables } : {}),
      ...(payables ? { payables } : {}),
      ...(cash ? { cash } : {}),
      ...(monthly ? { monthly } : {}),
      ...(stock ? { stock } : {}),
      ...(sales ? { sales } : {}),
      ...(purchasing ? { purchasing } : {}),
    };
  }

  private async agingSummary(companyId: string, side: "SALES" | "SUPPLIER", asOf: Date): Promise<AgingSummary> {
    const report = await this.aging.report(companyId, side, asOf);
    const t = report.totals;
    const overdue = [t.days1to30, t.days31to60, t.days61to90, t.over90].reduce((sum, v) => sum.plus(v), new Prisma.Decimal(0));
    return { total: t.total, overdue: overdue.toFixed(4) };
  }

  private async cash(companyId: string): Promise<{ balance: string | null }> {
    const used = await this.prisma.payment.findMany({ where: { companyId }, distinct: ["cashAccountId"], select: { cashAccountId: true } });
    if (used.length === 0) return { balance: null };
    const ids = used.map((u) => u.cashAccountId);
    const rows = await this.prisma.$queryRaw<{ debit: string; credit: string }[]>`
      SELECT COALESCE(SUM(l.base_debit), 0)::text AS debit, COALESCE(SUM(l.base_credit), 0)::text AS credit
      FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.journal_entry_id
      WHERE je.company_id = ${companyId} AND l.account_id = ANY(${ids}::text[])
    `;
    return { balance: new Prisma.Decimal(rows[0]?.debit ?? "0").minus(rows[0]?.credit ?? "0").toFixed(4) };
  }

  // Revenue and expense of the last six calendar months (this one included), oldest first; a month with
  // no postings is shown as zero so the chart has no gaps.
  private async monthly(companyId: string, today: Date): Promise<MonthlyResult[]> {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (MONTHS_SHOWN - 1), 1));
    const rows = await this.prisma.$queryRaw<{ month: string; revenue: string; expense: string }[]>`
      SELECT to_char(je.entry_date, 'YYYY-MM') AS month,
             COALESCE(SUM(CASE WHEN a.type = 'REVENUE' THEN l.base_credit - l.base_debit ELSE 0 END), 0)::text AS revenue,
             COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' THEN l.base_debit - l.base_credit ELSE 0 END), 0)::text AS expense
      FROM journal_entry_lines l
      JOIN journal_entries je ON je.id = l.journal_entry_id
      JOIN accounts a ON a.id = l.account_id
      WHERE je.company_id = ${companyId} AND a.type IN ('REVENUE', 'EXPENSE') AND je.entry_date >= ${start}::date
      GROUP BY 1
    `;
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    return Array.from({ length: MONTHS_SHOWN }, (_, i) => {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      const month = d.toISOString().slice(0, 7);
      const row = byMonth.get(month);
      return {
        month,
        revenue: new Prisma.Decimal(row?.revenue ?? "0").toFixed(4),
        expense: new Prisma.Decimal(row?.expense ?? "0").toFixed(4),
      };
    });
  }

  private async stock(companyId: string): Promise<{ value: string; belowReorder: number }> {
    const rows = await this.prisma.itemWarehouseStock.findMany({ where: { companyId }, include: { item: { select: { reorderPoint: true } } } });
    let value = new Prisma.Decimal(0);
    for (const r of rows) value = value.plus(r.value);
    // An item is below its reorder point when its on-hand total across warehouses is under the point.
    const onHand = new Map<string, { quantity: Prisma.Decimal; point: Prisma.Decimal }>();
    for (const r of rows) {
      const cur = onHand.get(r.itemId) ?? { quantity: new Prisma.Decimal(0), point: r.item.reorderPoint };
      onHand.set(r.itemId, { quantity: cur.quantity.plus(r.quantity), point: cur.point });
    }
    const belowReorder = [...onHand.values()].filter((o) => o.point.greaterThan(0) && o.quantity.lessThan(o.point)).length;
    return { value: value.toFixed(4), belowReorder };
  }

  private async salesSummary(companyId: string, today: Date): Promise<{ thisMonthNet: string; openQuotations: number; openOrders: number }> {
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const [invoices, creditNotes, openQuotations, openOrders] = await Promise.all([
      this.prisma.salesInvoice.aggregate({ where: { companyId, documentType: "INVOICE", invoiceDate: { gte: monthStart, lte: today } }, _sum: { totalNet: true } }),
      this.prisma.salesInvoice.aggregate({ where: { companyId, documentType: "CREDIT_NOTE", invoiceDate: { gte: monthStart, lte: today } }, _sum: { totalNet: true } }),
      this.prisma.quotation.count({ where: { companyId, status: "OPEN" } }),
      this.prisma.salesOrder.count({ where: { companyId, status: { in: ["OPEN", "PARTIALLY_INVOICED"] } } }),
    ]);
    const net = (invoices._sum.totalNet ?? new Prisma.Decimal(0)).minus(creditNotes._sum.totalNet ?? 0);
    return { thisMonthNet: net.toFixed(4), openQuotations, openOrders };
  }

  private async purchasingSummary(companyId: string): Promise<{ pendingApprovals: number; openOrders: number; pendingRequests: number }> {
    const [pendingApprovals, openOrders, pendingRequests] = await Promise.all([
      this.prisma.purchaseOrder.count({ where: { companyId, status: "PENDING_APPROVAL" } }),
      this.prisma.purchaseOrder.count({ where: { companyId, status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] } } }),
      this.prisma.purchaseRequest.count({ where: { companyId, status: "PENDING" } }),
    ]);
    return { pendingApprovals, openOrders, pendingRequests };
  }
}
