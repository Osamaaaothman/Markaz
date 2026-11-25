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
  AttachmentService,
  LocalFileStorage,
  PrismaAccountingEngine,
  PrismaNumberingService,
  SupplierInvoiceService,
  type IPermissionService,
} from "@erp/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPurchasingTools } from "./tools/purchasing-tools.js";
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
  // When set, the model answers this many calls from the script, then fails like an overloaded provider.
  let failAfter: number | null = null;
  class FailingModel extends ScriptedChatModel {
    private calls = 0;
    override _generate(...args: Parameters<ScriptedChatModel["_generate"]>): ReturnType<ScriptedChatModel["_generate"]> {
      this.calls += 1;
      if (failAfter !== null && this.calls > failAfter) return Promise.reject(Object.assign(new Error("This model is currently experiencing high demand"), { status: 503 }));
      return super._generate(...args);
    }
  }
  const chat = new AiChatService(db, permissions, audit, settings, tools, () => {
    lastModel = new FailingModel(script);
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

  beforeEach(() => { denied.clear(); failAfter = null; });

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

  it("a waiting card survives a new message, can be corrected on the card, and is approved later", async () => {
    script = [{ toolCalls: [{ name: "parties_createCustomer", args: { name: "QA Waiting Co" } }] }, { text: "Ready for review." }];
    const id = conversationOf(await run((emit) => chat.send(owner, { text: "create customer QA Waiting Co", mode: "review", locale: "en" }, emit)));

    // The user writes again before deciding: the card stays open and the model is told it still waits.
    script = [{ text: "The card is still waiting for you." }];
    const second = await run((emit) => chat.send(owner, { conversationId: id, text: "his phone is 0530031266", mode: "review", locale: "en" }, emit));
    expect(second).toContainEqual(expect.objectContaining({ type: "done", status: "AWAITING_APPROVAL" }));
    expect((await db.aiChangeItem.findFirst({ where: { conversationId: id, itemKey: "c1" } }))?.status).toBe("PROPOSED");
    const firstSent = lastModel?.seen[0]?.[0]?.content;
    const system = typeof firstSent === "string" ? firstSent : "";
    expect(system).toContain("STILL WAITING");
    expect(system).toContain("c1");
    expect(lastModel?.boundToolNames).toContain("withdraw_proposal");

    // The user corrects the card: every field of the tool is offered, the server re-checks and re-previews.
    const form = await chat.itemForm(owner, id, "c1");
    expect(Object.keys((form.schema as { properties: Record<string, unknown> }).properties)).toEqual(expect.arrayContaining(["name", "phone", "vatNumber"]));
    const revised = await chat.reviseItem(owner, id, "c1", { name: "QA Waiting Co", phone: "0530031266" }, "en");
    expect((revised.preview as { fields: unknown[] }).fields).toContainEqual({ labelKey: "ai.col.phone", value: "0530031266" });
    await expect(chat.reviseItem(owner, id, "c1", { name: "QA Waiting Co", vatNumber: "123" }, "en")).rejects.toThrow(AiChatError);
    await expect(chat.reviseItem(other, id, "c1", { name: "Hijack" }, "en")).rejects.toThrow(AiChatError);

    script = [{ text: "The customer was created." }];
    await run((emit) => chat.decide(owner, { conversationId: id, decisions: { c1: "approve" }, locale: "en" }, emit));
    expect(await db.party.findFirst({ where: { companyId, name: "QA Waiting Co" }, select: { phone: true } })).toEqual({ phone: "0530031266" });
    // A decided card can no longer be edited.
    await expect(chat.reviseItem(owner, id, "c1", { name: "Later" }, "en")).rejects.toThrow(AiChatError);
  });

  it("deciding one message's cards leaves another message's waiting cards open", async () => {
    script = [{ toolCalls: [{ name: "parties_createCustomer", args: { name: "QA First Card" } }] }, { text: "Ready." }];
    const id = conversationOf(await run((emit) => chat.send(owner, { text: "first", mode: "review", locale: "en" }, emit)));
    script = [{ toolCalls: [{ name: "parties_createCustomer", args: { name: "QA Second Card" } }] }, { text: "Ready." }];
    await run((emit) => chat.send(owner, { conversationId: id, text: "second", mode: "review", locale: "en" }, emit));

    script = [{ text: "Only the second one was decided." }];
    const decided = await run((emit) => chat.decide(owner, { conversationId: id, decisions: { c2: "reject" }, locale: "en" }, emit));
    expect(decided).toContainEqual(expect.objectContaining({ type: "done", status: "AWAITING_APPROVAL" }));
    const rows = await db.aiChangeItem.findMany({ where: { conversationId: id }, orderBy: { itemKey: "asc" }, select: { itemKey: true, status: true } });
    expect(rows).toEqual([{ itemKey: "c1", status: "PROPOSED" }, { itemKey: "c2", status: "REJECTED" }]);
  });

  it("the model withdraws a waiting card it replaces with a corrected one", async () => {
    script = [{ toolCalls: [{ name: "parties_createCustomer", args: { name: "QA Wrong Name" } }] }, { text: "Ready." }];
    const id = conversationOf(await run((emit) => chat.send(owner, { text: "create customer", mode: "review", locale: "en" }, emit)));
    script = [
      { toolCalls: [{ name: "withdraw_proposal", args: { id: "c1" } }, { name: "parties_createCustomer", args: { name: "QA Right Name" } }] },
      { text: "I replaced the card." },
    ];
    const events = await run((emit) => chat.send(owner, { conversationId: id, text: "no, the name is QA Right Name", mode: "review", locale: "en" }, emit));
    expect(events).toContainEqual({ type: "outcome", outcome: { key: "c1", status: "SKIPPED" } });
    const rows = await db.aiChangeItem.findMany({ where: { conversationId: id }, orderBy: { itemKey: "asc" }, select: { itemKey: true, status: true } });
    expect(rows).toEqual([{ itemKey: "c1", status: "SKIPPED" }, { itemKey: "c2", status: "PROPOSED" }]);
  });

  it("lists every supplier when asked without a search word", async () => {
    for (const name of ["QA Supplier A", "QA Supplier B", "QA Both Ways"]) {
      await db.party.create({ data: { id: newId(), companyId, ref: `PRT-L${name.slice(-1)}`, name, kind: name === "QA Both Ways" ? "CUSTOMER_SUPPLIER" : "SUPPLIER" } });
    }
    const search = tools.find((t) => t.name === "parties_search");
    if (!search || search.kind !== "read") throw new Error("parties_search missing");
    const ctx = { actor: { userId: owner.id, companyId }, locale: "en" as const, conversationId: "x", correlationId: "x", can: () => Promise.resolve(true) };
    const result = await search.run(ctx, search.input.parse({ kind: "SUPPLIER" }));
    const names = (result.data as { matches: Array<{ name: string }> }).matches.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(["QA Supplier A", "QA Supplier B", "QA Both Ways"]));
    expect((result.data as { more: boolean }).more).toBe(false);
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

  it("reads an attached invoice, posts it after approval with server totals, and keeps the file with it", async () => {
    const files = new AttachmentService(db, audit, permissions, new LocalFileStorage(mkdtempSync(join(tmpdir(), "ai-files-"))));
    const withFiles = new AiChatService(db, permissions, audit, settings, tools, () => {
      lastModel = new ScriptedChatModel(script);
      return Promise.resolve(lastModel);
    }, undefined, files);
    // A tiny valid PNG: the store checks the bytes, not the name.
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));
    script = [{ text: "I read it." }];
    const events = await run((emit) => withFiles.send(owner, { text: "enter this invoice", mode: "review", locale: "en", file: { name: "فاتورة.png", bytes: png } }, emit));
    const id = conversationOf(events);

    // The model received the picture's bytes; the database keeps only the reference.
    const sent = JSON.stringify(lastModel?.seen[0]?.at(-1)?.content);
    expect(sent).toContain(Buffer.from(png).toString("base64"));
    const row = await db.aiMessage.findFirstOrThrow({ where: { conversationId: id, role: "human" } });
    expect(JSON.stringify(row.payload)).not.toContain(Buffer.from(png).toString("base64"));
    expect(row.uiBlocks).toEqual([{ kind: "upload", name: "فاتورة.png", contentType: "image/png", sizeBytes: png.length }]);
    const fileId = /Attached file (f[0-9a-z]+)/.exec(sent)?.[1];
    expect(fileId).toBeDefined();

    // Books the invoice can post to.
    const year = new Date().getUTCFullYear();
    const fy = await db.fiscalYear.create({ data: { id: newId(), companyId, name: `FY${year}-ai`, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) } });
    await db.fiscalPeriod.create({ data: { id: newId(), companyId, fiscalYearId: fy.id, periodNumber: 1, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) } });
    const account = async (code: string, type: string, normalBalance: string): Promise<string> =>
      (await db.account.create({ data: { id: newId(), ref: `AI-${code}-${companyId.slice(0, 6)}`, companyId, code, name: code, type, normalBalance, isPostable: true } })).id;
    const mappings = new AccountMappingService(db, audit);
    await mappings.set("ACCOUNTS_PAYABLE", await account("2100", "LIABILITY", "CREDIT"), owner, "t");
    await mappings.set("VAT_INPUT", await account("1300", "ASSET", "DEBIT"), owner, "t");
    await account("5200", "EXPENSE", "DEBIT");
    if (!(await db.taxCode.findFirst({ where: { companyId, code: "VAT15" } }))) {
      await db.taxCode.create({ data: { id: newId(), companyId, code: "VAT15", name: "Standard 15%", rate: "15", treatment: "STANDARD" } });
    }
    const supplier = await new PartyService(db, audit).create({ name: "Office Rent Co", kind: "SUPPLIER" }, owner, "t");

    const invoices = new SupplierInvoiceService(db, new PrismaAccountingEngine(db, new PrismaNumberingService()), mappings, audit);
    const [, createInvoice] = buildPurchasingTools({ prisma: db, invoices, attachments: files });
    if (createInvoice?.kind !== "write") throw new Error("unexpected tool kind");
    expect(createInvoice.risk).toBe("high");
    const ctx = { actor: { userId: owner.id, companyId }, locale: "en" as const, conversationId: id, correlationId: `ai:${id}`, can: () => Promise.resolve(true) };
    const args = {
      supplierId: supplier.id, supplierInvoiceNumber: "R-77", invoiceDate: `${year}-03-01`, sourceFileId: fileId,
      lines: [{ kind: "EXPENSE", accountCode: "5200", description: "March rent", quantity: "1", unitPrice: "1000" }],
    };

    // A misread total on the document is flagged; the card shows the server's figures.
    const misread = await createInvoice.preview(ctx, createInvoice.input.parse({ ...args, documentTotals: { gross: "1100.00" } }));
    expect(misread.warningKeys).toContain("ai.warn.totalsMismatch");
    // 30 x 83.3333 is the printed 2500.00 once rounded to the printed cents: no false mismatch.
    const split = await createInvoice.preview(ctx, createInvoice.input.parse({
      ...args, lines: [{ ...args.lines[0], quantity: "30", unitPrice: "83.3333" }], documentTotals: { net: "2500.00", tax: "375.00", gross: "2875.00" },
    }));
    expect(split.warningKeys).toBeUndefined();
    const input = createInvoice.input.parse({ ...args, documentTotals: { net: "1000", tax: "150", gross: "1150.00" } });
    const preview = await createInvoice.preview(ctx, input);
    expect(preview.warningKeys).toBeUndefined();
    expect(preview.fields.find((f) => f.labelKey === "ai.col.total")?.value).toBe("1150.00");

    const done = await createInvoice.execute(ctx, input);
    const invoiceId = (done.data as { id: string; fileAttached: boolean }).id;
    expect((done.data as { fileAttached: boolean }).fileAttached).toBe(true);
    const saved = await db.supplierInvoice.findFirstOrThrow({ where: { companyId, id: invoiceId } });
    expect(saved.totalGross.toFixed(2)).toBe("1150.00");
    const attached = await db.attachment.findMany({ where: { companyId, ownerType: "SUPPLIER_INVOICE", ownerId: invoiceId } });
    expect(attached.map((a) => a.originalName)).toEqual(["فاتورة.png"]);

    // A file id from another conversation is not found.
    expect((await createInvoice.preview({ ...ctx, conversationId: "other" }, input)).warningKeys).toContain("ai.warn.fileNotFound");
  });

  it("a turn belongs to the server: it is not running once saved, and only its owner can stop it", async () => {
    script = [{ text: "done" }];
    const events = await run((emit) => chat.send(owner, { text: "hello", mode: "ask", locale: "en" }, emit));
    const id = conversationOf(events);
    expect(chat.isRunning(id)).toBe(false);
    expect((await chat.get(owner, id)).conversation.running).toBe(false);
    await expect(chat.stop(owner, id)).resolves.toEqual({ stopped: false });
    await expect(chat.stop(other, id)).rejects.toThrow(AiChatError);
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

  it("keeps the cards shown before the model failed, so they can still be approved", async () => {
    script = [{ toolCalls: [{ name: "parties_createSupplier", args: { name: "QA Partial Supplier" } }] }];
    failAfter = 1;
    const first = await run((emit) => chat.send(owner, { text: "create a supplier", mode: "review", locale: "en" }, emit));
    const id = conversationOf(first);
    expect(first).toContainEqual(expect.objectContaining({ type: "error", code: "PROVIDER_BUSY" }));
    expect(first).toContainEqual(expect.objectContaining({ type: "done", status: "AWAITING_APPROVAL" }));
    expect(await db.aiChangeItem.count({ where: { conversationId: id, status: "PROPOSED" } })).toBe(1);

    failAfter = null;
    script = [{ text: "The supplier was created." }];
    const second = await run((emit) => chat.decide(owner, { conversationId: id, decisions: { c1: "approve" }, locale: "en" }, emit));
    const outcome = second.find((e) => e.type === "outcome") as { outcome: { key: string; status: string } } | undefined;
    expect(outcome?.outcome).toMatchObject({ key: "c1", status: "EXECUTED" });
    expect(await db.party.count({ where: { companyId, name: "QA Partial Supplier" } })).toBe(1);
  });
});
