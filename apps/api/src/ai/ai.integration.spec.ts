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

// The whole assistant path against real PostgreSQL, with a scripted model instead of a provider:
// permissions, proposals, approval, execution through the core services, the freeze trigger,
// and conversation ownership.
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
    const ctx = { actor: { userId: owner.id, companyId }, locale: "ar" as const, conversationId: "t", correlationId: "ai:t", can: () => Promise.resolve(true) };
    const args: Record<string, unknown> = { parties_statement: { party: "QA Supplier Co", side: "SUPPLIER" }, accounts_statement: { code: "NOPE" } };
    for (const tool of reports) {
      if (tool.kind !== "read") continue;
      const input = tool.input.parse(args[tool.name] ?? {});
      const result = await tool.run(ctx, input);
      expect(result.data).toBeDefined();
    }
  });
});
