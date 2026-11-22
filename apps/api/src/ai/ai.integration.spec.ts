import { ScriptedChatModel, type ScriptedReply } from "@erp/ai";
import {
  AccountMappingService,
  AgingService,
  ApprovalService,
  BalanceSheetService,
  CashFlowService,
  ChartOfAccountsService,
  GeneralLedgerService,
  IncomeStatementService,
  PartyStatementService,
  PurchaseOrderService,
  QuotationService,
  TrialBalanceService,
  StockLevelService,
  DashboardService,
  EmployeeService,
  ItemService,
  PartyService,
  PrismaAuditLogger,
  type IPermissionService,
} from "@erp/core";
import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { AiChatError, AiChatService, type ChatEvent } from "./ai-chat.service.js";
import { AiSettingsService } from "./ai-settings.service.js";
import { buildErpTools } from "./tools/erp-tools.js";
import { buildReportTools } from "./tools/report-tools.js";
import { buildDocumentTools } from "./tools/document-tools.js";
import { buildSalesTools } from "./tools/sales-tools.js";

// The whole assistant path against real PostgreSQL, with a scripted model instead of a provider:
// permissions, proposals, approval, execution through the core services, the freeze trigger,
// and conversation ownership.
// One scripted model per turn; backup models are covered by the graph tests.
process.env["AI_FALLBACK_MODELS"] = "none";

(process.env.DATABASE_URL ? describe : describe.skip)("AI assistant — real PostgreSQL", () => {
  const db = new PrismaClient();
  const companyId = newId();
  const owner = { id: newId(), companyId };
  const other = { id: newId(), companyId };
  const audit = new PrismaAuditLogger(db);
  // Per-user grants: "<userId>:<resource>:<action>"; "*" grants everything to the owner.
  const denied = new Set<string>();
  const permissions: IPermissionService = { can: (actorId, action, resource) => Promise.resolve(!denied.has(`${actorId}:${resource}:${action}`)) };
  const tools = buildErpTools({
    prisma: db,
    parties: new PartyService(db, audit),
    employees: new EmployeeService(db, audit),
    items: new ItemService(db, audit),
    accounts: new ChartOfAccountsService(db, audit),
    dashboard: new DashboardService(db, new AgingService(db, new AccountMappingService(db, audit))),
  });
  const settings = new AiSettingsService(db, audit, { AI_PROVIDER: "google", AI_MODEL: "scripted", GEMINI_API_KEY: "unused" });
  let script: ScriptedReply[] = [];
  let lastModel: ScriptedChatModel | null = null;
  const chat = new AiChatService(db, permissions, audit, settings, tools, () => {
    lastModel = new ScriptedChatModel(script);
    return Promise.resolve(lastModel);
  });
  const run = async (fn: (emit: (e: ChatEvent) => void) => Promise<void>): Promise<ChatEvent[]> => {
    const events: ChatEvent[] = [];
    await fn((e) => events.push(e));
    return events;
  };
  const conversationOf = (events: ChatEvent[]): string => (events.find((e) => e.type === "conversation") as { id: string }).id;

  beforeAll(async () => {
    await db.company.create({ data: { id: companyId, name: "AI QA", nameAr: "اختبار المساعد", defaultCurrency: "SAR" } });
    for (const [user, ref] of [[owner, "USR-A1"], [other, "USR-A2"]] as const) {
      await db.user.create({ data: { ...user, ref, email: `${user.id}@example.test`, passwordHash: "unused" } });
    }
  });

  afterAll(async () => {
    await db.aiConversation.deleteMany({ where: { companyId } });
    await db.$disconnect();
  });

  beforeEach(() => denied.clear());

  it("ask mode never offers a write tool to the model", async () => {
    script = [{ text: "Switch to interactive mode to create things." }];
    await run((emit) => chat.send(owner, { text: "create a customer called X", mode: "ask", locale: "en" }, emit));
    expect(lastModel?.boundToolNames.some((n) => n.startsWith("parties_create"))).toBe(false);
    expect(lastModel?.boundToolNames).toContain("parties_search");
  });

  it("review mode proposes, then creates only what the user approves", async () => {
    script = [
      { toolCalls: [{ name: "parties_createSupplier", args: { name: "QA Supplier Co" } }, { name: "parties_createCustomer", args: { name: "QA Customer Co" } }] },
      { text: "Two changes are ready for review." },
    ];
    const first = await run((emit) => chat.send(owner, { text: "create a supplier and a customer", mode: "review", locale: "en" }, emit));
    const id = conversationOf(first);
    expect(first).toContainEqual(expect.objectContaining({ type: "done", status: "AWAITING_APPROVAL" }));
    expect(await db.party.count({ where: { companyId } })).toBe(0);

    script = [{ text: "The supplier was created; the customer was not." }];
    const second = await run((emit) => chat.decide(owner, { conversationId: id, decisions: { c1: "approve", c2: "reject" }, locale: "en" }, emit));
    expect(second.filter((e) => e.type === "outcome").map((e) => (e as { outcome: { status: string } }).outcome.status)).toEqual(["EXECUTED", "REJECTED"]);
    const parties = await db.party.findMany({ where: { companyId }, select: { name: true, kind: true } });
    expect(parties).toEqual([{ name: "QA Supplier Co", kind: "SUPPLIER" }]);
    // The core service wrote the audit row, tagged with the conversation.
    expect(await db.auditLog.count({ where: { action: "party.created", correlationId: `ai:${id}` } })).toBe(1);

    // A second decision on the same proposals is refused (double click, second tab).
    await expect(chat.decide(owner, { conversationId: id, decisions: { c1: "approve" }, locale: "en" }, () => undefined)).rejects.toThrow(AiChatError);
  });

  it("decided changes are frozen by the database", async () => {
    const executed = await db.aiChangeItem.findFirstOrThrow({ where: { companyId, status: "EXECUTED" } });
    await expect(db.aiChangeItem.update({ where: { id: executed.id }, data: { status: "PROPOSED" } })).rejects.toThrow();
  });

  it("another user cannot read or act on someone else's conversation", async () => {
    const mine = await db.aiConversation.findFirstOrThrow({ where: { companyId, userId: owner.id } });
    await expect(chat.get(other, mine.id)).rejects.toThrow(AiChatError);
    await expect(chat.send(other, { conversationId: mine.id, text: "hi", mode: "ask", locale: "en" }, () => undefined)).rejects.toThrow(AiChatError);
    expect((await chat.list(other)).length).toBe(0);
  });

  it("a user without interact permission cannot use review mode", async () => {
    denied.add(`${owner.id}:ai_assistant:interact`);
    await expect(chat.send(owner, { text: "create", mode: "review", locale: "en" }, () => undefined)).rejects.toThrow(AiChatError);
  });

  it("auto mode is refused while the company switch is off", async () => {
    await expect(chat.send(owner, { text: "create", mode: "auto", locale: "en" }, () => undefined)).rejects.toThrow("AUTO_MODE_OFF");
  });

  it("a write the user may not do is never proposed", async () => {
    denied.add(`${owner.id}:party:create`);
    script = [{ toolCalls: [{ name: "parties_createCustomer", args: { name: "Blocked" } }] }, { text: "I cannot do that." }];
    const events = await run((emit) => chat.send(owner, { text: "create customer Blocked", mode: "review", locale: "en" }, emit));
    expect(events.some((e) => e.type === "proposed")).toBe(false);
    expect(lastModel?.boundToolNames).not.toContain("parties_createCustomer");
  });

  it("every report tool runs against the real schema for an empty company", async () => {
    const aging = new AgingService(db, new AccountMappingService(db, audit));
    const reports = buildReportTools({
      prisma: db,
      stock: new StockLevelService(db),
      incomeStatement: new IncomeStatementService(db),
      balanceSheet: new BalanceSheetService(db),
      cashFlow: new CashFlowService(db),
      aging,
      partyStatements: new PartyStatementService(db),
      ledger: new GeneralLedgerService(db),
      purchaseOrders: new PurchaseOrderService(db, new ApprovalService(), audit),
    });
    // Every document list too, with filters set so each optional branch reaches the real schema.
    reports.push(...buildDocumentTools({ prisma: db, trialBalance: new TrialBalanceService(db) }));
    const ctx = { actor: { userId: owner.id, companyId }, locale: "ar" as const, conversationId: "t", correlationId: "ai:t", can: () => Promise.resolve(true) };
    const args: Record<string, unknown> = { parties_statement: { party: "QA Supplier Co", side: "SUPPLIER" }, accounts_statement: { code: "NOPE" }, salesInvoices_get: { number: "INV-NOPE" }, journalEntries_search: { from: "2026-01-01", to: "2026-12-31", number: "JE", accountCode: "1" }, reports_trialBalance: { from: "2026-01-01", to: "2026-12-31" }, quotations_search: { query: "x", status: "OPEN", from: "2026-01-01" }, payments_search: { direction: "RECEIPT", query: "x" }, fixedAssets_search: { query: "x" }, hr_salaryAdvances: { employee: "x" } };
    for (const tool of reports) {
      if (tool.kind !== "read") continue;
      const input = tool.input.parse(args[tool.name] ?? {});
      const result = await tool.run(ctx, input);
      expect(result.data).toBeDefined();
    }
  });

  it("prepares a quotation with server-computed totals, then creates it through the core service", async () => {
    const [taxList, createQuotation] = buildSalesTools({ prisma: db, quotations: new QuotationService(db, audit) });
    if (taxList?.kind !== "read" || createQuotation?.kind !== "write") throw new Error("unexpected tool kinds");
    await db.taxCode.create({ data: { id: newId(), companyId, code: "VAT15", name: "Standard 15%", rate: "15", treatment: "STANDARD" } });
    const customer = await new PartyService(db, audit).create({ name: "Chair Buyer", kind: "CUSTOMER" }, owner, "ai:q");
    const ctx = { actor: { userId: owner.id, companyId }, locale: "en" as const, conversationId: "q", correlationId: "ai:q", can: () => Promise.resolve(true) };
    const input = createQuotation.input.parse({ customerId: customer.id, quotationDate: "2026-11-22", lines: [{ description: "Chairs", quantity: "2", unitPrice: "100" }] });

    const preview = await createQuotation.preview(ctx, input);
    const value = (key: string): string | undefined => preview.fields.find((f) => f.labelKey === key)?.value;
    expect(preview.warningKeys).toBeUndefined();
    expect([value("ai.col.net"), value("ai.col.tax"), value("ai.col.total")]).toEqual(["200.00", "30.00", "230.00"]);

    const done = await createQuotation.execute(ctx, input);
    const saved = await db.quotation.findFirstOrThrow({ where: { companyId, id: (done.data as { id: string }).id } });
    expect(saved.totalGross.toFixed(2)).toBe("230.00");
    expect(saved.status).toBe("OPEN");
  });

  it("compacts a long conversation into a summary the model then receives as memory", async () => {
    // Small limits so three turns are enough. Each model creation takes the next script from the queue.
    const queue: ScriptedReply[][] = [];
    let last: ScriptedChatModel | null = null;
    const compacting = new AiChatService(db, permissions, audit, settings, tools, () => {
      last = new ScriptedChatModel(queue.shift() ?? [{ text: "ok" }]);
      return Promise.resolve(last);
    }, { maxTokens: 300, keepRecentTokens: 100 });
    const long = "تفاصيل ".repeat(200);
    queue.push([{ text: `first answer ${long}` }]);
    const first = await run((emit) => compacting.send(owner, { text: `first question ${long}`, mode: "ask", locale: "ar" }, emit));
    const id = conversationOf(first);
    queue.push([{ text: `second answer ${long}` }]);
    await run((emit) => compacting.send(owner, { conversationId: id, text: `second question ${long}`, mode: "ask", locale: "ar" }, emit));
    // Third turn: the history is over the limit, so the first exchange is folded into a summary.
    queue.push([{ text: "- Created supplier PRT-000123 for the user" }], [{ text: "third answer" }]);
    const third = await run((emit) => compacting.send(owner, { conversationId: id, text: "third question", mode: "ask", locale: "ar" }, emit));
    expect(third).toContainEqual(expect.objectContaining({ type: "compacted", compactions: 1 }));
    const conv = await db.aiConversation.findUniqueOrThrow({ where: { id } });
    expect(conv.summary).toContain("PRT-000123");
    expect(conv.summaryThroughSeq).toBeGreaterThan(0);
    // The answering model got the summary in its system prompt and no longer got the first question.
    const sent = (last as ScriptedChatModel | null)?.seen[0] ?? [];
    expect(JSON.stringify(sent[0]?.content ?? "")).toContain("PRT-000123");
    expect(JSON.stringify(sent.slice(1).map((m) => m.content))).not.toContain("first question");
    // The user still sees every message, plus a divider where the compaction happened.
    const detail = await compacting.get(owner, id);
    expect(detail.messages.some((m) => m.role === "divider")).toBe(true);
    expect(detail.messages.filter((m) => m.role === "user")).toHaveLength(3);
  });
});
