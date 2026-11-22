import { defineReadTool, type DisplayBlock, type ErpTool, type ToolContext } from "@erp/ai";
import type { TrialBalanceService } from "@erp/core";
import { Prisma, type PrismaClient } from "@erp/db";
import { z } from "zod";

// Read-only lists of every document type the ERP keeps, so the assistant can answer "show me the
// last 3 journal entries / open quotations / this month's payments". Each query is filtered by the
// actor's companyId and guarded by the same read permission as the screen. Totals are summed here
// with exact decimals; the model never adds money.

export interface DocumentToolServices {
  readonly prisma: PrismaClient;
  readonly trialBalance: TrialBalanceService;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const limit = z.number().int().min(1).max(25).default(10).describe("How many, newest first (max 25)");
const query = z.string().trim().max(100).optional().describe("Number, name or text to match");
const money = (v: Prisma.Decimal | null | undefined): string => (v ?? new Prisma.Decimal(0)).toFixed(2);
const day = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : "");
const nameOf = (ctx: ToolContext, p: { name: string; nameAr: string | null } | null | undefined): string => (p ? (ctx.locale === "ar" && p.nameAr ? p.nameAr : p.name) : "");
const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });
type DayFilter = { gte?: Date; lte?: Date };
// { [key]: { gte, lte } } for a date range, or {} when no date was given.
function within<K extends string>(key: K, from?: string, to?: string): { [P in K]?: DayFilter } {
  if (!from && !to) return {};
  const filter: DayFilter = { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) };
  return { [key]: filter } as { [P in K]?: DayFilter };
}

type Col = Extract<DisplayBlock, { kind: "table" }>["columns"][number];
const col = (key: string, format?: Col["format"]): Col => ({ key, labelKey: `ai.col.${key}`, ...(format ? { format } : {}) });
const table = (titleKey: string, columns: Col[], rows: Array<Record<string, string>>, link: string): DisplayBlock => ({ kind: "table", titleKey, columns, rows, link });

export function buildDocumentTools(s: DocumentToolServices): ErpTool[] {
  const db = s.prisma;

  const journalEntries = defineReadTool({
    name: "journalEntries_search",
    description:
      "Posted journal entries, newest first, with their lines (account, debit, credit). Filter by date range, entry number, " +
      "or account code. Use for 'last N journal entries' or 'entries on account X'.",
    input: z.object({ limit: limit.default(5), from: date.optional(), to: date.optional(), number: z.string().trim().max(40).optional(), accountCode: z.string().trim().max(20).optional() }),
    permission: { resource: "journal_entry", action: "read" },
    run: async (ctx, a) => {
      const entries = await db.journalEntry.findMany({
        where: {
          companyId: ctx.actor.companyId,
          ...within("entryDate", a.from, a.to),
          ...(a.number ? { number: contains(a.number) } : {}),
          ...(a.accountCode ? { lines: { some: { account: { code: a.accountCode } } } } : {}),
        },
        orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
        take: a.limit,
        select: { id: true, number: true, entryDate: true, sourceDocumentType: true, reversalOfEntryId: true, lines: { orderBy: { lineNumber: "asc" }, select: { debit: true, credit: true, description: true, account: { select: { code: true, name: true, nameAr: true } } } } },
      });
      const data = entries.map((e) => {
        const total = e.lines.reduce((sum, l) => sum.add(l.debit), new Prisma.Decimal(0));
        return {
          number: e.number,
          date: day(e.entryDate),
          source: e.sourceDocumentType,
          reversal: e.reversalOfEntryId ? "yes" : "no",
          total: money(total),
          lines: e.lines.map((l) => ({ account: `${l.account.code} ${nameOf(ctx, l.account)}`, debit: money(l.debit), credit: money(l.credit), description: l.description ?? "" })),
        };
      });
      const rows = data.flatMap((e) => e.lines.map((l, i) => ({ number: i === 0 ? e.number : "", date: i === 0 ? e.date : "", account: l.account, debit: l.debit, credit: l.credit })));
      return { data, display: table("ai.blocks.journalEntries", [col("number"), col("date", "date"), col("account"), col("debit", "money"), col("credit", "money")], rows, "/accounting/journal-entries") };
    },
  });

  const trialBalance = defineReadTool({
    name: "reports_trialBalance",
    description: "Trial balance. Without dates: all-time balances per account. With from/to: opening, movement and closing per account.",
    input: z.object({ from: date.optional(), to: date.optional() }),
    permission: { resource: "trial_balance", action: "read" },
    run: async (ctx, a) => {
      if (a.from && a.to) {
        const r = await s.trialBalance.computeForPeriod(ctx.actor.companyId, new Date(`${a.from}T00:00:00Z`), new Date(`${a.to}T00:00:00Z`));
        const rows = r.lines.map((l) => ({ code: l.accountCode, name: l.accountName, closingDebit: l.closingDebit, closingCredit: l.closingCredit }));
        return { data: { from: r.from, to: r.to, isBalanced: r.isBalanced, totals: r.totals, lines: r.lines }, display: table("ai.blocks.trialBalance", [col("code"), col("name"), col("closingDebit", "money"), col("closingCredit", "money")], rows, "/accounting/trial-balance") };
      }
      const r = await s.trialBalance.compute(ctx.actor.companyId);
      const rows = r.lines.map((l) => ({ code: l.accountCode, name: l.accountName, debit: l.debitTotal, credit: l.creditTotal }));
      return { data: { totalDebit: r.totalDebit, totalCredit: r.totalCredit, isBalanced: r.isBalanced, lines: rows }, display: table("ai.blocks.trialBalance", [col("code"), col("name"), col("debit", "money"), col("credit", "money")], rows, "/accounting/trial-balance") };
    },
  });

  // Sales and purchase documents share one shape: number, date, party, status, total.
  const partySelect = { select: { name: true, nameAr: true } } as const;
  const docInput = z.object({ limit, query, from: date.optional(), to: date.optional(), status: z.string().trim().max(30).optional().describe("Exact status, e.g. OPEN, CONVERTED, CANCELLED") });

  const quotations = defineReadTool({
    name: "quotations_search",
    description: "Sales quotations (price offers), newest first, with customer, status and total.",
    input: docInput,
    permission: { resource: "quotation", action: "read" },
    run: async (ctx, a) => {
      const list = await db.quotation.findMany({
        where: { companyId: ctx.actor.companyId, ...(a.status ? { status: a.status } : {}), ...within("quotationDate", a.from, a.to), ...(a.query ? { OR: [{ number: contains(a.query) }, { customer: { name: contains(a.query) } }, { customer: { nameAr: contains(a.query) } }] } : {}) },
        orderBy: [{ quotationDate: "desc" }, { createdAt: "desc" }], take: a.limit,
        select: { number: true, quotationDate: true, validUntil: true, status: true, totalGross: true, customer: partySelect },
      });
      const rows = list.map((q) => ({ number: q.number, date: day(q.quotationDate), validUntil: day(q.validUntil), customer: nameOf(ctx, q.customer), status: q.status, total: money(q.totalGross) }));
      return { data: rows, display: table("ai.blocks.quotations", [col("number"), col("date", "date"), col("customer"), col("status"), col("total", "money")], rows, "/sales/quotations") };
    },
  });

  const salesOrders = defineReadTool({
    name: "salesOrders_search",
    description: "Sales orders, newest first, with customer, status and total.",
    input: docInput,
    permission: { resource: "sales_order", action: "read" },
    run: async (ctx, a) => {
      const list = await db.salesOrder.findMany({
        where: { companyId: ctx.actor.companyId, ...(a.status ? { status: a.status } : {}), ...within("orderDate", a.from, a.to), ...(a.query ? { OR: [{ number: contains(a.query) }, { customer: { name: contains(a.query) } }, { customer: { nameAr: contains(a.query) } }] } : {}) },
        orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }], take: a.limit,
        select: { number: true, orderDate: true, status: true, totalGross: true, customer: partySelect },
      });
      const rows = list.map((o) => ({ number: o.number, date: day(o.orderDate), customer: nameOf(ctx, o.customer), status: o.status, total: money(o.totalGross) }));
      return { data: rows, display: table("ai.blocks.salesOrders", [col("number"), col("date", "date"), col("customer"), col("status"), col("total", "money")], rows, "/sales/orders") };
    },
  });

  const deliveryNotes = defineReadTool({
    name: "deliveryNotes_search",
    description: "Goods delivery notes to customers, newest first, with the sales order they deliver.",
    input: docInput.omit({ status: true }),
    permission: { resource: "sales_delivery_note", action: "read" },
    run: async (ctx, a) => {
      const list = await db.goodsDeliveryNote.findMany({
        where: { companyId: ctx.actor.companyId, ...within("deliveryDate", a.from, a.to), ...(a.query ? { OR: [{ number: contains(a.query) }, { customer: { name: contains(a.query) } }, { customer: { nameAr: contains(a.query) } }] } : {}) },
        orderBy: [{ deliveryDate: "desc" }, { createdAt: "desc" }], take: a.limit,
        select: { number: true, deliveryDate: true, receiverName: true, customer: partySelect, salesOrder: { select: { number: true } } },
      });
      const rows = list.map((d) => ({ number: d.number, date: day(d.deliveryDate), customer: nameOf(ctx, d.customer), order: d.salesOrder.number, receiver: d.receiverName ?? "" }));
      return { data: rows, display: table("ai.blocks.deliveryNotes", [col("number"), col("date", "date"), col("customer"), col("order"), col("receiver")], rows, "/sales/delivery-notes") };
    },
  });

  const supplierInvoices = defineReadTool({
    name: "supplierInvoices_search",
    description: "Supplier (purchase) invoices and debit notes, newest first, with supplier, due date and total.",
    input: docInput.omit({ status: true }),
    permission: { resource: "supplier_invoice", action: "read" },
    run: async (ctx, a) => {
      const list = await db.supplierInvoice.findMany({
        where: { companyId: ctx.actor.companyId, ...within("invoiceDate", a.from, a.to), ...(a.query ? { OR: [{ number: contains(a.query) }, { supplierInvoiceNumber: contains(a.query) }, { supplier: { name: contains(a.query) } }, { supplier: { nameAr: contains(a.query) } }] } : {}) },
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }], take: a.limit,
        select: { number: true, documentType: true, supplierInvoiceNumber: true, invoiceDate: true, dueDate: true, totalGross: true, supplier: partySelect },
      });
      const rows = list.map((i) => ({ number: i.number, type: i.documentType, supplierRef: i.supplierInvoiceNumber ?? "", date: day(i.invoiceDate), dueDate: day(i.dueDate), supplier: nameOf(ctx, i.supplier), total: money(i.totalGross) }));
      return { data: rows, display: table("ai.blocks.supplierInvoices", [col("number"), col("date", "date"), col("supplier"), col("dueDate", "date"), col("total", "money")], rows, "/purchasing/invoices") };
    },
  });

  const payments = defineReadTool({
    name: "payments_search",
    description: "Customer receipts (RECEIPT) and supplier payments (PAYMENT), newest first, with party, method and amount. The total of the listed rows is returned.",
    input: z.object({ limit, query, from: date.optional(), to: date.optional(), direction: z.enum(["RECEIPT", "PAYMENT", "ANY"]).default("ANY") }),
    permission: { resource: "payment", action: "read" },
    run: async (ctx, a) => {
      const list = await db.payment.findMany({
        where: { companyId: ctx.actor.companyId, ...(a.direction !== "ANY" ? { direction: a.direction } : {}), ...within("paymentDate", a.from, a.to), ...(a.query ? { OR: [{ number: contains(a.query) }, { reference: contains(a.query) }, { party: { name: contains(a.query) } }, { party: { nameAr: contains(a.query) } }] } : {}) },
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }], take: a.limit,
        select: { number: true, direction: true, paymentDate: true, amount: true, method: true, voidedAt: true, party: partySelect },
      });
      const rows = list.map((p) => ({ number: p.number, direction: p.direction, date: day(p.paymentDate), party: nameOf(ctx, p.party), method: p.method, amount: money(p.amount), voided: p.voidedAt ? "yes" : "no" }));
      const total = list.filter((p) => !p.voidedAt).reduce((sum, p) => sum.add(p.amount), new Prisma.Decimal(0));
      return { data: { rows, totalOfListedNotVoided: money(total) }, display: table("ai.blocks.payments", [col("number"), col("date", "date"), col("direction"), col("party"), col("method"), col("amount", "money")], rows, "/payments/receipts") };
    },
  });

  const cashExpenses = defineReadTool({
    name: "cashExpenses_search",
    description: "Cash expenses paid from a cash or bank account, newest first. The total of the listed rows is returned.",
    input: z.object({ limit, query, from: date.optional(), to: date.optional() }),
    permission: { resource: "cash_expense", action: "read" },
    run: async (ctx, a) => {
      const list = await db.cashExpense.findMany({
        where: { companyId: ctx.actor.companyId, ...within("expenseDate", a.from, a.to), ...(a.query ? { OR: [{ number: contains(a.query) }, { description: contains(a.query) }, { reference: contains(a.query) }] } : {}) },
        orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }], take: a.limit,
        select: { number: true, expenseDate: true, amount: true, description: true, cashAccount: { select: { code: true, name: true, nameAr: true } } },
      });
      const rows = list.map((e) => ({ number: e.number, date: day(e.expenseDate), description: e.description ?? "", account: `${e.cashAccount.code} ${nameOf(ctx, e.cashAccount)}`, amount: money(e.amount) }));
      const total = list.reduce((sum, e) => sum.add(e.amount), new Prisma.Decimal(0));
      return { data: { rows, totalOfListed: money(total) }, display: table("ai.blocks.cashExpenses", [col("number"), col("date", "date"), col("description"), col("account"), col("amount", "money")], rows, "/payments/cash-expenses") };
    },
  });

  const stockMovements = defineReadTool({
    name: "inventory_stockMovements",
    description: "Stock movements (in/out per item and warehouse), newest first. Filter by item code, warehouse code or date range.",
    input: z.object({ limit, itemCode: z.string().trim().max(20).optional(), warehouseCode: z.string().trim().max(20).optional(), from: date.optional(), to: date.optional() }),
    permission: { resource: "stock", action: "read" },
    run: async (ctx, a) => {
      const list = await db.stockMovement.findMany({
        where: { companyId: ctx.actor.companyId, ...(a.itemCode ? { item: { code: a.itemCode } } : {}), ...(a.warehouseCode ? { warehouse: { code: a.warehouseCode } } : {}), ...within("createdAt", a.from, a.to) },
        orderBy: { createdAt: "desc" }, take: a.limit,
        select: { createdAt: true, movementType: true, quantity: true, unitCost: true, value: true, sourceDocumentType: true, item: { select: { code: true, name: true, nameAr: true } }, warehouse: { select: { code: true } } },
      });
      const rows = list.map((m) => ({ date: day(m.createdAt), item: `${m.item.code} ${nameOf(ctx, m.item)}`, warehouse: m.warehouse.code, movementType: m.movementType, quantity: m.quantity.toString(), value: money(m.value), source: m.sourceDocumentType }));
      return { data: rows, display: table("ai.blocks.stockMovements", [col("date", "date"), col("item"), col("warehouse"), col("movementType"), col("quantity", "number"), col("value", "money")], rows, "/inventory/movements") };
    },
  });

  const warehouses = defineReadTool({
    name: "inventory_warehouses",
    description: "Warehouses with their code and whether they are active.",
    input: z.object({}),
    permission: { resource: "warehouse", action: "read" },
    run: async (ctx) => {
      const list = await db.warehouse.findMany({ where: { companyId: ctx.actor.companyId }, orderBy: { code: "asc" }, select: { code: true, name: true, nameAr: true, isActive: true } });
      const rows = list.map((w) => ({ code: w.code, name: nameOf(ctx, w), active: w.isActive ? "yes" : "no" }));
      return { data: rows, display: table("ai.blocks.warehouses", [col("code"), col("name"), col("active")], rows, "/inventory/warehouses") };
    },
  });

  const goodsReceipts = defineReadTool({
    name: "goodsReceipts_search",
    description: "Goods receipts (stock received from suppliers), newest first, with warehouse and purchase order.",
    input: z.object({ limit, query, from: date.optional(), to: date.optional() }),
    permission: { resource: "goods_receipt", action: "read" },
    run: async (ctx, a) => {
      const list = await db.goodsReceipt.findMany({
        where: { companyId: ctx.actor.companyId, ...within("documentDate", a.from, a.to), ...(a.query ? { OR: [{ number: contains(a.query) }, { reference: contains(a.query) }, { party: { name: contains(a.query) } }] } : {}) },
        orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }], take: a.limit,
        select: { number: true, documentDate: true, party: partySelect, warehouse: { select: { code: true } }, purchaseOrder: { select: { number: true } } },
      });
      const rows = list.map((g) => ({ number: g.number, date: day(g.documentDate), supplier: nameOf(ctx, g.party), warehouse: g.warehouse.code, order: g.purchaseOrder?.number ?? "" }));
      return { data: rows, display: table("ai.blocks.goodsReceipts", [col("number"), col("date", "date"), col("supplier"), col("warehouse"), col("order")], rows, "/inventory/goods-receipts") };
    },
  });

  const purchaseRequests = defineReadTool({
    name: "purchaseRequests_search",
    description: "Internal purchase requests, newest first, with status (e.g. PENDING, APPROVED, REJECTED, CONVERTED).",
    input: z.object({ limit, query, status: z.string().trim().max(30).optional() }),
    permission: { resource: "purchase_request", action: "read" },
    run: async (ctx, a) => {
      const list = await db.purchaseRequest.findMany({
        where: { companyId: ctx.actor.companyId, ...(a.status ? { status: a.status } : {}), ...(a.query ? { OR: [{ number: contains(a.query) }, { notes: contains(a.query) }] } : {}) },
        orderBy: { createdAt: "desc" }, take: a.limit,
        select: { number: true, status: true, createdAt: true, notes: true, purchaseOrder: { select: { number: true } } },
      });
      const rows = list.map((r) => ({ number: r.number, date: day(r.createdAt), status: r.status, order: r.purchaseOrder?.number ?? "", notes: r.notes ?? "" }));
      return { data: rows, display: table("ai.blocks.purchaseRequests", [col("number"), col("date", "date"), col("status"), col("order")], rows, "/purchasing/requests") };
    },
  });

  const fixedAssets = defineReadTool({
    name: "fixedAssets_search",
    description: "Fixed assets with category, status, cost, accumulated depreciation and net book value (computed here).",
    input: z.object({ limit, query, status: z.string().trim().max(30).optional() }),
    permission: { resource: "fixed_asset", action: "read" },
    run: async (ctx, a) => {
      const list = await db.fixedAsset.findMany({
        where: { companyId: ctx.actor.companyId, ...(a.status ? { status: a.status } : {}), ...(a.query ? { OR: [{ number: contains(a.query) }, { name: contains(a.query) }, { nameAr: contains(a.query) }, { serialNumber: contains(a.query) }] } : {}) },
        orderBy: { acquisitionDate: "desc" }, take: a.limit,
        select: { number: true, name: true, nameAr: true, status: true, acquisitionDate: true, acquisitionCost: true, accumulatedDepreciation: true, category: { select: { name: true, nameAr: true } } },
      });
      const rows = list.map((f) => ({ number: f.number, name: nameOf(ctx, f), category: nameOf(ctx, f.category), status: f.status, date: day(f.acquisitionDate), cost: money(f.acquisitionCost), accumulated: money(f.accumulatedDepreciation), netBookValue: money(f.acquisitionCost.sub(f.accumulatedDepreciation)) }));
      return { data: rows, display: table("ai.blocks.fixedAssets", [col("number"), col("name"), col("category"), col("status"), col("cost", "money"), col("netBookValue", "money")], rows, "/fixed-assets") };
    },
  });

  const payrollRuns = defineReadTool({
    name: "hr_payrollRuns",
    description: "Payroll runs by month, newest first, with gross, GOSI, advance deductions and net totals.",
    input: z.object({ limit, year: z.number().int().min(2000).max(2100).optional() }),
    permission: { resource: "payroll_run", action: "read" },
    run: async (ctx, a) => {
      const list = await db.payrollRun.findMany({
        where: { companyId: ctx.actor.companyId, ...(a.year ? { periodYear: a.year } : {}) },
        orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }], take: a.limit,
        select: { number: true, periodYear: true, periodMonth: true, runDate: true, totalGross: true, totalGosiEmployee: true, totalGosiEmployer: true, totalAdvanceDeduction: true, totalNet: true, _count: { select: { lines: true } } },
      });
      const rows = list.map((p) => ({ number: p.number, period: `${p.periodYear}-${String(p.periodMonth).padStart(2, "0")}`, employees: String(p._count.lines), gross: money(p.totalGross), gosiEmployee: money(p.totalGosiEmployee), gosiEmployer: money(p.totalGosiEmployer), advances: money(p.totalAdvanceDeduction), net: money(p.totalNet) }));
      return { data: rows, display: table("ai.blocks.payrollRuns", [col("number"), col("period"), col("employees", "number"), col("gross", "money"), col("net", "money")], rows, "/hr/payroll-runs") };
    },
  });

  const salaryAdvances = defineReadTool({
    name: "hr_salaryAdvances",
    description: "Salary advances granted to employees, newest first, with amount and monthly installment.",
    input: z.object({ limit, employee: z.string().trim().max(100).optional().describe("Employee name or reference") }),
    permission: { resource: "salary_advance", action: "read" },
    run: async (ctx, a) => {
      const list = await db.salaryAdvance.findMany({
        where: { companyId: ctx.actor.companyId, ...(a.employee ? { employee: { OR: [{ name: contains(a.employee) }, { nameAr: contains(a.employee) }, { ref: contains(a.employee) }] } } : {}) },
        orderBy: [{ grantDate: "desc" }, { createdAt: "desc" }], take: a.limit,
        select: { number: true, grantDate: true, amount: true, installmentAmount: true, employee: { select: { name: true, nameAr: true } } },
      });
      const rows = list.map((v) => ({ number: v.number, date: day(v.grantDate), employee: nameOf(ctx, v.employee), amount: money(v.amount), installment: money(v.installmentAmount) }));
      return { data: rows, display: table("ai.blocks.salaryAdvances", [col("number"), col("date", "date"), col("employee"), col("amount", "money"), col("installment", "money")], rows, "/hr/payments") };
    },
  });

  return [journalEntries, trialBalance, quotations, salesOrders, deliveryNotes, supplierInvoices, payments, cashExpenses, stockMovements, warehouses, goodsReceipts, purchaseRequests, fixedAssets, payrollRuns, salaryAdvances];
}
