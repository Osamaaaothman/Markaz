import { defineReadTool, defineWriteTool, type DisplayBlock, type ErpTool, type ToolContext } from "@erp/ai";
import type {
  AccountType,
  ChartOfAccountsService,
  DashboardSections,
  DashboardService,
  EmployeeService,
  ItemService,
  PartyService,
} from "@erp/core";
import { Prisma, type PrismaClient } from "@erp/db";
import { z } from "zod";

// Every tool calls the same core service the web endpoint calls (numbering, audit and validation
// live there). Reads that have no list service query Prisma directly — always filtered by the
// actor's companyId. Framework-free on purpose so it can be unit-tested without Nest.

export interface AiToolServices {
  readonly prisma: PrismaClient;
  readonly parties: PartyService;
  readonly employees: EmployeeService;
  readonly items: ItemService;
  readonly accounts: ChartOfAccountsService;
  readonly dashboard: DashboardService;
}

const LIMIT = 10;
// "List all suppliers": enough for a small company's whole list; `more` tells the model when it is not.
const LIST_LIMIT = 50;
const decimal = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, "decimal string such as 3000.00");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const shortText = (max: number) => z.string().trim().min(1).max(max);
const localName = (ctx: ToolContext, en: string, ar: string | null): string => (ctx.locale === "ar" && ar ? ar : en);

function table(titleKey: string, columns: Extract<DisplayBlock, { kind: "table" }>["columns"], rows: Array<Record<string, string>>, link?: string): DisplayBlock {
  return { kind: "table", titleKey, columns, rows, ...(link ? { link } : {}) };
}

export function buildErpTools(s: AiToolServices): ErpTool[] {
  const actorOf = (ctx: ToolContext) => ({ id: ctx.actor.userId, companyId: ctx.actor.companyId });

  // ─── Reads ──────────────────────────────────────────────────────────────────────────────────
  const dashboardOverview = defineReadTool({
    name: "dashboard_overview",
    description:
      "Company overview right now: receivables and payables (total and overdue), cash balance, this month's net sales, " +
      "stock value, items below reorder point, pending purchase approvals, and revenue/expense for the last 6 months. " +
      "Only sections the user may see are returned.",
    input: z.object({}),
    // The dashboard itself only needs a login; each section is filtered by its own permission below.
    permission: { resource: "ai_assistant", action: "use" },
    run: async (ctx) => {
      const [aging, income, balance, stock, sales, purchasing] = await Promise.all([
        ctx.can("aging_report", "read"),
        ctx.can("income_statement", "read"),
        ctx.can("balance_sheet", "read"),
        ctx.can("stock", "read"),
        ctx.can("sales_invoice", "read"),
        ctx.can("purchase_order", "read"),
      ]);
      const sections: DashboardSections = { receivables: aging, payables: aging, profit: income, cash: balance, stock, sales, purchasing };
      const d = await s.dashboard.compute(ctx.actor.companyId, sections);
      const items: Array<{ labelKey: string; value: string; format: "money" | "number"; currency?: string }> = [];
      const money = (labelKey: string, value: string | null | undefined): void => { if (value) items.push({ labelKey, value, format: "money", currency: d.currency }); };
      money("ai.kpi.salesThisMonth", d.sales?.thisMonthNet);
      money("ai.kpi.receivables", d.receivables?.total);
      money("ai.kpi.overdueReceivables", d.receivables?.overdue);
      money("ai.kpi.payables", d.payables?.total);
      money("ai.kpi.cash", d.cash?.balance);
      money("ai.kpi.stockValue", d.stock?.value);
      if (d.stock) items.push({ labelKey: "ai.kpi.belowReorder", value: String(d.stock.belowReorder), format: "number" });
      if (d.purchasing) items.push({ labelKey: "ai.kpi.pendingApprovals", value: String(d.purchasing.pendingApprovals), format: "number" });
      // The monthly chart is its own tool (reports_monthlyRevenueExpense) so a block is one thing.
      return { data: d, display: { kind: "kpis", titleKey: "ai.blocks.overview", items } };
    },
  });

  const monthlyChart = defineReadTool({
    name: "reports_monthlyRevenueExpense",
    description: "Revenue and expense per month for the last 6 months, as a chart. Use for trends and comparisons between months.",
    input: z.object({}),
    permission: { resource: "income_statement", action: "read" },
    run: async (ctx) => {
      const d = await s.dashboard.compute(ctx.actor.companyId, { receivables: false, payables: false, profit: true, cash: false, stock: false, sales: false, purchasing: false });
      const monthly = d.monthly ?? [];
      // Net per month and six-month totals are computed here with exact decimals, so the model never
      // does arithmetic on money (it only reports these figures).
      const dec = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
      const rows = monthly.map((m) => ({ month: m.month, revenue: dec(m.revenue).toFixed(2), expense: dec(m.expense).toFixed(2), net: dec(m.revenue).minus(dec(m.expense)).toFixed(2) }));
      const sum = (key: "revenue" | "expense"): Prisma.Decimal => monthly.reduce((acc, m) => acc.plus(dec(m[key])), new Prisma.Decimal(0));
      const totals = { revenue: sum("revenue").toFixed(2), expense: sum("expense").toFixed(2), net: sum("revenue").minus(sum("expense")).toFixed(2) };
      return {
        data: { currency: d.currency, months: rows, totals },
        display: {
          kind: "chart",
          titleKey: "ai.blocks.revenueExpense",
          chartType: "bar",
          labels: monthly.map((m) => m.month),
          series: [
            { labelKey: "ai.kpi.revenue", values: monthly.map((m) => m.revenue) },
            { labelKey: "ai.kpi.expense", values: monthly.map((m) => m.expense) },
          ],
        },
      };
    },
  });

  const searchParties = defineReadTool({
    name: "parties_search",
    description:
      "Search customers and suppliers by name, code or phone. Omit query to LIST them all (with kind SUPPLIER for all suppliers, " +
      "CUSTOMER for all customers). SUPPLIER and CUSTOMER include parties that are both. `more: true` means the list is partial.",
    input: z.object({ query: z.string().trim().max(100).optional(), kind: z.enum(["CUSTOMER", "SUPPLIER", "ANY"]).default("ANY") }),
    permission: { resource: "party", action: "read" },
    run: async (ctx, input) => {
      const q = input.query?.trim();
      const page = await s.parties.list(ctx.actor.companyId, { ...(q ? { q } : {}), limit: String(q ? LIMIT : LIST_LIMIT), excludeEmployees: "true", ...(input.kind !== "ANY" ? { kind: input.kind } : {}) });
      const rows = page.data.map((p) => ({ id: p.id, ref: p.ref, name: localName(ctx, p.name, p.nameAr), kind: p.kind, phone: p.phone ?? "" }));
      return {
        data: { matches: rows, more: page.pageInfo.hasMore },
        display: table("ai.blocks.parties", [{ key: "ref", labelKey: "ai.col.ref" }, { key: "name", labelKey: "ai.col.name" }, { key: "kind", labelKey: "ai.col.kind" }, { key: "phone", labelKey: "ai.col.phone" }], rows, "/parties"),
      };
    },
  });

  const searchEmployees = defineReadTool({
    name: "employees_search",
    description: "Search employees by name, reference or national ID. Returns basic salary and hire date.",
    input: z.object({ query: shortText(100) }),
    permission: { resource: "employee", action: "read" },
    run: async (ctx, input) => {
      const page = await s.employees.list(ctx.actor.companyId, { q: input.query, limit: String(LIMIT) });
      // No IBAN or national ID to the model: it does not need them to answer, and less data leaves the server.
      const rows = page.data.map((e) => ({ id: e.id, ref: e.ref, name: localName(ctx, e.name, e.nameAr), hireDate: e.hireDate, basicSalary: e.basicSalary }));
      return {
        data: rows,
        display: table("ai.blocks.employees", [{ key: "ref", labelKey: "ai.col.ref" }, { key: "name", labelKey: "ai.col.name" }, { key: "hireDate", labelKey: "ai.col.hireDate", format: "date" }, { key: "basicSalary", labelKey: "ai.col.basicSalary", format: "money" }], rows, "/hr/employees"),
      };
    },
  });

  const searchItems = defineReadTool({
    name: "items_search",
    description: "Search inventory items by name or code.",
    input: z.object({ query: shortText(100) }),
    permission: { resource: "item", action: "read" },
    run: async (ctx, input) => {
      const page = await s.items.list(ctx.actor.companyId, { q: input.query, limit: String(LIMIT) });
      const rows = page.data.map((i) => ({ id: i.id, code: i.code, name: localName(ctx, i.name, i.nameAr), unit: i.unit, reorderPoint: i.reorderPoint }));
      return {
        data: rows,
        display: table("ai.blocks.items", [{ key: "code", labelKey: "ai.col.code" }, { key: "name", labelKey: "ai.col.name" }, { key: "unit", labelKey: "ai.col.unit" }, { key: "reorderPoint", labelKey: "ai.col.reorderPoint", format: "number" }], rows, "/inventory/items"),
      };
    },
  });

  const searchInvoices = defineReadTool({
    name: "salesInvoices_search",
    description:
      "Find issued sales invoices. Filter by customer name, invoice number, and/or a date range. Returns the newest first " +
      "with totals and the total of all matches (computed by the system).",
    input: z.object({ query: z.string().trim().max(100).optional(), from: date.optional(), to: date.optional() }),
    permission: { resource: "sales_invoice", action: "read" },
    run: async (ctx, input) => {
      const where = {
        companyId: ctx.actor.companyId,
        documentType: "INVOICE",
        ...(input.from || input.to ? { invoiceDate: { ...(input.from ? { gte: new Date(`${input.from}T00:00:00Z`) } : {}), ...(input.to ? { lte: new Date(`${input.to}T00:00:00Z`) } : {}) } } : {}),
        ...(input.query
          ? { OR: [{ number: { contains: input.query, mode: "insensitive" as const } }, { customer: { name: { contains: input.query, mode: "insensitive" as const } } }, { customer: { nameAr: { contains: input.query } } }] }
          : {}),
      };
      const [found, sum] = await Promise.all([
        s.prisma.salesInvoice.findMany({ where, orderBy: [{ invoiceDate: "desc" }, { number: "desc" }], take: LIMIT, include: { customer: { select: { name: true, nameAr: true } } } }),
        s.prisma.salesInvoice.aggregate({ where, _sum: { totalGross: true, totalNet: true }, _count: { _all: true } }),
      ]);
      const rows = found.map((i) => ({
        id: i.id,
        number: i.number,
        customer: localName(ctx, i.customer.name, i.customer.nameAr),
        date: i.invoiceDate.toISOString().slice(0, 10),
        totalGross: i.totalGross.toFixed(2),
      }));
      return {
        data: { matches: sum._count._all, sumNet: sum._sum.totalNet?.toFixed(2) ?? "0.00", sumGross: sum._sum.totalGross?.toFixed(2) ?? "0.00", newest: rows },
        display: {
          kind: "table",
          titleKey: "ai.blocks.invoices",
          columns: [{ key: "number", labelKey: "ai.col.number" }, { key: "customer", labelKey: "ai.col.customer" }, { key: "date", labelKey: "ai.col.date", format: "date" }, { key: "totalGross", labelKey: "ai.col.total", format: "money" }],
          rows: rows.map((r) => ({ ...r, _link: `/sales/invoices/${r.id}` })),
          link: "/sales/invoices",
        },
      };
    },
  });

  const searchAccounts = defineReadTool({
    name: "accounts_search",
    description:
      "Search the chart of accounts by name or code. Use it to find a parent account code before creating an account, or an account to post to: " +
      "only rows with group \"no\" (detail accounts) can be used on invoices, payments and journal lines. Set postableOnly when the user must pick an account to post to (a bank or cash account for a payment).",
    input: z.object({ query: shortText(100), postableOnly: z.boolean().default(false) }),
    permission: { resource: "account", action: "read" },
    run: async (ctx, input) => {
      const found = await s.prisma.account.findMany({
        where: { companyId: ctx.actor.companyId, ...(input.postableOnly ? { isPostable: true, isActive: true } : {}), OR: [{ code: { startsWith: input.query } }, { name: { contains: input.query, mode: "insensitive" } }, { nameAr: { contains: input.query } }] },
        orderBy: { code: "asc" },
        take: LIMIT,
        select: { code: true, name: true, nameAr: true, type: true, isPostable: true, isActive: true },
      });
      const rows = found.map((a) => ({ code: a.code, name: localName(ctx, a.name, a.nameAr), type: a.type, group: a.isPostable ? "no" : "yes", active: a.isActive ? "yes" : "no" }));
      return {
        data: rows,
        display: table("ai.blocks.accounts", [{ key: "code", labelKey: "ai.col.code" }, { key: "name", labelKey: "ai.col.name" }, { key: "type", labelKey: "ai.col.type" }, { key: "group", labelKey: "ai.col.group" }], rows, "/accounting/chart-of-accounts"),
      };
    },
  });

  // ─── Writes (all low risk: master data and drafts the user can still edit or deactivate) ─────
  const partyInput = z.object({
    name: shortText(200).describe("Name in English or as given"),
    nameAr: z.string().trim().max(200).optional().describe("Arabic name, if known"),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().email().max(200).optional(),
    vatNumber: z.string().regex(/^3\d{13}3$/, "Saudi VAT number: 15 digits starting and ending with 3").optional(),
  });
  type PartyArgs = z.infer<typeof partyInput>;
  const partyPreview = (titleKey: string) => (_ctx: ToolContext, a: PartyArgs) => Promise.resolve({
    titleKey,
    entity: "party",
    fields: [
      { labelKey: "ai.col.name", value: a.name },
      ...(a.nameAr ? [{ labelKey: "ai.col.nameAr", value: a.nameAr }] : []),
      ...(a.phone ? [{ labelKey: "ai.col.phone", value: a.phone }] : []),
      ...(a.email ? [{ labelKey: "ai.col.email", value: a.email }] : []),
      ...(a.vatNumber ? [{ labelKey: "ai.col.vatNumber", value: a.vatNumber }] : []),
    ],
  });
  const createParty = (kind: "CUSTOMER" | "SUPPLIER") => async (ctx: ToolContext, a: PartyArgs) => {
    const p = await s.parties.create(
      { name: a.name, kind, ...(a.nameAr ? { nameAr: a.nameAr } : {}), ...(a.phone ? { phone: a.phone } : {}), ...(a.email ? { email: a.email } : {}), ...(a.vatNumber ? { vatNumber: a.vatNumber } : {}) },
      actorOf(ctx),
      ctx.correlationId,
    );
    return { data: { id: p.id, ref: p.ref, name: p.name }, link: { label: p.ref, path: "/parties" } };
  };

  const createCustomer = defineWriteTool({
    name: "parties_createCustomer",
    description: "Create a new customer. Search first (parties_search) to avoid a duplicate.",
    input: partyInput,
    permission: { resource: "party", action: "create" },
    risk: "low",
    preview: partyPreview("ai.preview.createCustomer"),
    execute: createParty("CUSTOMER"),
  });

  const createSupplier = defineWriteTool({
    name: "parties_createSupplier",
    description: "Create a new supplier (vendor). Search first (parties_search) to avoid a duplicate.",
    input: partyInput,
    permission: { resource: "party", action: "create" },
    risk: "low",
    preview: partyPreview("ai.preview.createSupplier"),
    execute: createParty("SUPPLIER"),
  });

  const employeeInput = z.object({
    name: shortText(200).describe("Full name in English or as given"),
    nameAr: z.string().trim().max(200).optional(),
    nationalId: z.string().regex(/^[12]\d{9}$/, "10 digits: 1... for Saudi ID, 2... for Iqama").describe("Saudi national ID or Iqama number"),
    isSaudi: z.boolean().describe("true for a Saudi national"),
    bankIban: z.string().regex(/^SA\d{22}$/, "Saudi IBAN: SA followed by 22 digits"),
    bankName: z.string().trim().max(100).optional(),
    hireDate: date,
    basicSalary: decimal.describe("Monthly basic salary"),
  });
  const createEmployee = defineWriteTool({
    name: "hr_createEmployee",
    description:
      "Create a new employee. Required: name, national ID or Iqama, Saudi or not, IBAN, hire date, monthly basic salary. " +
      "Ask the user for anything missing — never invent an ID or IBAN. Allowances are added later on the employee page.",
    input: employeeInput,
    permission: { resource: "employee", action: "create" },
    risk: "low",
    preview: (_ctx, a) => Promise.resolve({
      titleKey: "ai.preview.createEmployee",
      entity: "employee",
      fields: [
        { labelKey: "ai.col.name", value: a.name },
        ...(a.nameAr ? [{ labelKey: "ai.col.nameAr", value: a.nameAr }] : []),
        { labelKey: "ai.col.nationalId", value: a.nationalId },
        { labelKey: "ai.col.nationality", value: a.isSaudi ? "ai.value.saudi" : "ai.value.nonSaudi" },
        { labelKey: "ai.col.iban", value: a.bankIban },
        { labelKey: "ai.col.hireDate", value: a.hireDate },
        { labelKey: "ai.col.basicSalary", value: a.basicSalary },
      ],
    }),
    execute: async (ctx, a) => {
      const e = await s.employees.create(
        { name: a.name, nationalId: a.nationalId, isSaudi: a.isSaudi, bankIban: a.bankIban, hireDate: new Date(`${a.hireDate}T00:00:00Z`), basicSalary: a.basicSalary, ...(a.nameAr ? { nameAr: a.nameAr } : {}), ...(a.bankName ? { bankName: a.bankName } : {}) },
        actorOf(ctx),
        ctx.correlationId,
      );
      return { data: { id: e.id, ref: e.ref, name: e.name }, link: { label: e.ref, path: `/hr/employees/${e.id}` } };
    },
  });

  const createItem = defineWriteTool({
    name: "inventory_createItem",
    description: "Create an inventory item. Code must be unique (letters/digits, max 20). Unit is a short label like 'piece', 'box', 'kg'.",
    input: z.object({
      code: z.string().trim().min(1).max(20),
      name: shortText(200),
      nameAr: z.string().trim().max(200).optional(),
      unit: shortText(20),
      reorderPoint: decimal.optional(),
    }),
    permission: { resource: "item", action: "create" },
    risk: "low",
    preview: (_ctx, a) => Promise.resolve({
      titleKey: "ai.preview.createItem",
      entity: "item",
      fields: [
        { labelKey: "ai.col.code", value: a.code },
        { labelKey: "ai.col.name", value: a.name },
        ...(a.nameAr ? [{ labelKey: "ai.col.nameAr", value: a.nameAr }] : []),
        { labelKey: "ai.col.unit", value: a.unit },
        ...(a.reorderPoint ? [{ labelKey: "ai.col.reorderPoint", value: a.reorderPoint }] : []),
      ],
    }),
    execute: async (ctx, a) => {
      const i = await s.items.create({ code: a.code, name: a.name, unit: a.unit, ...(a.nameAr ? { nameAr: a.nameAr } : {}), ...(a.reorderPoint ? { reorderPoint: a.reorderPoint } : {}) }, actorOf(ctx), ctx.correlationId);
      return { data: { id: i.id, ref: i.ref, code: i.code }, link: { label: i.code, path: "/inventory/items" } };
    },
  });

  const createAccount = defineWriteTool({
    name: "accounting_createAccount",
    description:
      "Create a ledger account in the chart of accounts under an existing group account. Find the parent's code first " +
      "with accounts_search. The new account takes the parent's type. Code: letters/digits, max 20, normally the parent code plus a suffix.",
    input: z.object({
      parentCode: z.string().trim().min(1).max(20),
      code: z.string().regex(/^[A-Za-z0-9]{1,20}$/),
      name: shortText(200),
      nameAr: z.string().trim().max(200).optional(),
      isGroup: z.boolean().default(false).describe("true to create a group (header) account instead of a postable one"),
    }),
    permission: { resource: "account", action: "create" },
    risk: "low",
    preview: async (ctx, a) => {
      const parent = await s.prisma.account.findFirst({ where: { companyId: ctx.actor.companyId, code: a.parentCode }, select: { name: true, nameAr: true, type: true, isPostable: true } });
      return {
        titleKey: "ai.preview.createAccount",
        entity: "account",
        fields: [
          { labelKey: "ai.col.parent", value: parent ? `${a.parentCode} — ${localName(ctx, parent.name, parent.nameAr)}` : a.parentCode },
          { labelKey: "ai.col.code", value: a.code },
          { labelKey: "ai.col.name", value: a.name },
          ...(a.nameAr ? [{ labelKey: "ai.col.nameAr", value: a.nameAr }] : []),
          { labelKey: "ai.col.type", value: parent?.type ?? "?" },
        ],
        ...(!parent ? { warningKeys: ["ai.warn.parentNotFound"] } : parent.isPostable ? { warningKeys: ["ai.warn.parentNotGroup"] } : {}),
      };
    },
    execute: async (ctx, a) => {
      const parent = await s.prisma.account.findFirst({ where: { companyId: ctx.actor.companyId, code: a.parentCode }, select: { id: true, type: true } });
      if (!parent) throw Object.assign(new Error("Parent account not found"), { code: "PARENT_NOT_FOUND" });
      // The column only holds AccountType values.
      const type = parent.type as AccountType;
      const acc = await s.accounts.create(
        { code: a.code, name: a.name, type, isPostable: !a.isGroup, parentId: parent.id, ...(a.nameAr ? { nameAr: a.nameAr } : {}) },
        actorOf(ctx),
        ctx.correlationId,
      );
      return { data: { id: acc.id, ref: acc.ref, code: acc.code }, link: { label: acc.code, path: "/accounting/chart-of-accounts" } };
    },
  });

  return [dashboardOverview, monthlyChart, searchParties, searchEmployees, searchItems, searchInvoices, searchAccounts, createCustomer, createSupplier, createEmployee, createItem, createAccount];
}
