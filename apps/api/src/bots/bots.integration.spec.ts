import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import {
  AgingService,
  AccountMappingService,
  ApprovalService,
  DashboardService,
  ItemService,
  PartyService,
  PartyStatementService,
  PrismaAuditLogger,
  PurchaseOrderService,
  StockLevelService,
  type AttachmentService,
  type IPermissionService,
  type SalesInvoiceService,
} from "@erp/core";
import type {
  BotMessage,
  ChannelAdapter,
  ChatTarget,
  ConnectionTestResult,
  InboundEvent,
  InstallResult,
  OutboundFile,
  OutboundTarget,
  SentMessageRef,
  WebhookParseResult,
} from "@erp/bots";
import { TelegramAdapter } from "@erp/bots";
import { AdapterRegistry, BotVault } from "./application/bot-core.js";
import { BotConnectionService } from "./application/bot-connection.service.js";
import { BotLinkService } from "./application/bot-link.service.js";
import { BotRuntime, type BotLogger } from "./application/bot-runtime.js";
import { BotScheduler, type DeliveryJob } from "./application/bot-scheduler.js";
import type { BotServices } from "./features/feature-kit.js";
import { createApprovalsFeature } from "./features/approvals.feature.js";
import { createLookupsFeature } from "./features/lookups.feature.js";
import { createMenuFeature } from "./features/menu.feature.js";
import { createReportsFeature } from "./features/reports.feature.js";

// End to end against real PostgreSQL with a fake chat platform: linking, menu, the approval alert,
// confirm + approve from chat, and the security checks around action tokens.

interface Recorded {
  readonly op: "reply" | "send" | "edit" | "prompt";
  readonly message: BotMessage | null;
  readonly text?: string;
}

class FakeTelegram implements ChannelAdapter {
  readonly provider = "telegram" as const;
  private readonly real = new TelegramAdapter();
  readonly capabilities = this.real.capabilities;
  readonly credentialFields = this.real.credentialFields;
  readonly secretKeys = this.real.secretKeys;
  readonly log: Recorded[] = [];
  private seq = 0;

  testConnection(): Promise<ConnectionTestResult> {
    return Promise.resolve({ ok: true, identity: { id: "1", username: "@qa_bot", displayName: "QA" } });
  }
  install(): Promise<InstallResult> {
    return Promise.resolve({ webhookConfigured: false, commandsRegistered: 0 });
  }
  uninstall(): Promise<void> {
    return Promise.resolve();
  }
  parseWebhook(): WebhookParseResult {
    return { status: "ignored" };
  }
  immediateResponse(): unknown {
    return {};
  }
  acknowledge(): Promise<void> {
    return Promise.resolve();
  }
  showActivity(): Promise<void> {
    return Promise.resolve();
  }
  reply(event: InboundEvent, message: BotMessage): Promise<SentMessageRef> {
    this.log.push({ op: "reply", message });
    return Promise.resolve({ chatId: event.chat.chatId, messageId: String(++this.seq) });
  }
  replyFile(event: InboundEvent): Promise<SentMessageRef> {
    return Promise.resolve({ chatId: event.chat.chatId, messageId: String(++this.seq) });
  }
  send(target: OutboundTarget, message: BotMessage): Promise<SentMessageRef> {
    this.log.push({ op: "send", message });
    return Promise.resolve({ chatId: target.chatId, messageId: String(++this.seq) });
  }
  edit(_ref: SentMessageRef, message: BotMessage): Promise<void> {
    this.log.push({ op: "edit", message });
    return Promise.resolve();
  }
  sendFile(target: OutboundTarget, _file: OutboundFile, caption: BotMessage | null): Promise<SentMessageRef> {
    this.log.push({ op: "send", message: caption });
    return Promise.resolve({ chatId: target.chatId, messageId: String(++this.seq) });
  }
  sendPrompt(target: OutboundTarget, text: string): Promise<SentMessageRef> {
    this.log.push({ op: "prompt", message: null, text });
    return Promise.resolve({ chatId: target.chatId, messageId: String(++this.seq) });
  }
  openDirectChat(userId: string): Promise<ChatTarget> {
    return Promise.resolve({ chatId: userId, isPrivate: true });
  }
  downloadFile(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }
  last(): Recorded {
    const entry = this.log.at(-1);
    if (!entry) throw new Error("nothing recorded");
    return entry;
  }
}

function actionIds(message: BotMessage | null): string[] {
  return (message?.actions ?? []).flatMap((row) => row.items.flatMap((a) => (a.type === "button" ? [a.action] : a.type === "select" ? a.options.map((o) => o.action) : [])));
}

function title(message: BotMessage | null): string {
  const header = message?.blocks.find((b) => b.type === "header");
  return header && header.type === "header" ? header.title : "";
}

const silent: BotLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

(process.env.DATABASE_URL ? describe : describe.skip)("Chat bots — real PostgreSQL", () => {
  const db = new PrismaClient();
  const companyId = newId();
  const approver = { id: newId(), companyId };
  const requester = { id: newId(), companyId };
  const outsider = { id: newId(), companyId };
  const poId = newId();
  const fake = new FakeTelegram();
  const audit = new PrismaAuditLogger(db);
  const denied = new Set<string>();
  const permissions: IPermissionService = { can: (actorId) => Promise.resolve(!denied.has(actorId)) };
  const registry = new AdapterRegistry([fake]);
  const vault = new BotVault();
  const config = { publicApiBaseUrl: null, webAppUrl: "https://erp.example.test", runtimeEnabled: true };
  const links = new BotLinkService(db, audit);
  const aging = new AgingService(db, new AccountMappingService(db, audit));
  const services: BotServices = {
    prisma: db,
    purchaseOrders: new PurchaseOrderService(db, new ApprovalService(), audit),
    parties: new PartyService(db, audit),
    statements: new PartyStatementService(db),
    aging,
    items: new ItemService(db, audit),
    stock: new StockLevelService(db),
    invoices: {} as SalesInvoiceService,
    dashboard: new DashboardService(db, aging),
    invoicePdfs: {} as BotServices["invoicePdfs"],
    receivablesExport: {} as BotServices["receivablesExport"],
    attachments: {} as AttachmentService,
    links,
    runtime: null,
    maxInboundFileBytes: 1024 * 1024,
  };
  const runtime = new BotRuntime(db, permissions, audit, registry, vault, config, silent, [
    createMenuFeature(services),
    createApprovalsFeature(services),
    createLookupsFeature(services),
    createReportsFeature(services),
  ]);
  services.runtime = runtime;
  const queued: DeliveryJob[] = [];
  const scheduler = new BotScheduler(db, runtime, services, { enqueue: (job) => Promise.resolve(void queued.push(job)) }, silent);
  const connections = new BotConnectionService(db, audit, registry, vault, config);
  let connectionId = "";
  let eventSeq = 0;
  const event = (sender: string, rest: Record<string, unknown>): InboundEvent =>
    ({ provider: "telegram", eventId: `qa:${++eventSeq}`, sender: { id: sender }, chat: { chatId: sender, isPrivate: true }, ...rest }) as InboundEvent;
  const tapIntent = async (message: BotMessage | null, a: string): Promise<string> => {
    for (const id of actionIds(message)) {
      const token = await db.botActionToken.findUnique({ where: { id } });
      if ((token?.intent as { a?: string } | null)?.a === a) return id;
    }
    throw new Error(`no ${a} button`);
  };

  beforeAll(async () => {
    process.env["BOT_CREDENTIALS_ENCRYPTION_KEY"] = Buffer.alloc(32, 9).toString("base64");
    await db.company.create({ data: { id: companyId, name: "Bots QA", nameAr: "اختبار البوت", defaultCurrency: "SAR" } });
    for (const [user, ref] of [[approver, "USR-B1"], [requester, "USR-B2"], [outsider, "USR-B3"]] as const) {
      await db.user.create({ data: { ...user, ref, email: `${user.id}@example.test`, passwordHash: "unused" } });
    }
    const supplierId = newId();
    await db.party.create({ data: { id: supplierId, companyId, ref: "P-B1", kind: "COMPANY", name: "Noor Trading", nameAr: "تجارة النور" } });
    const approvalId = newId();
    await db.approvalRequest.create({ data: { id: approvalId, companyId, subjectType: "purchase_order", subjectId: poId, amount: "48300", currency: "SAR", requestedBy: requester.id, correlationId: newId() } });
    await db.purchaseOrder.create({
      data: { id: poId, companyId, number: "PO-QA-1", supplierId, status: "PENDING_APPROVAL", orderDate: new Date("2026-11-15"), currency: "SAR", totalAmount: "42000", totalTax: "6300", approvalRequestId: approvalId, requestedBy: requester.id, correlationId: newId() },
    });
    const created = await connections.create(
      { provider: "telegram", transport: "polling", credentials: { botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef" }, acceptDataSharing: true, approvalCeiling: null },
      approver,
      newId(),
    );
    connectionId = created.id;
  });

  afterAll(async () => {
    await db.botConnection.deleteMany({ where: { companyId } });
    await db.$disconnect();
  });

  it("never returns a secret and stores the token encrypted", async () => {
    const view = await connections.get(companyId, connectionId);
    expect(JSON.stringify(view)).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef");
    expect(view.secrets["botToken"]).toEqual({ set: true, last4: "cdef" });
    const row = await db.botConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(Buffer.from(row.credentialsCiphertext).toString("utf8")).not.toContain("ABCDEFGHIJ");
  });

  it("refuses everything but linking to an unlinked chat user", async () => {
    await runtime.handleInbound(connectionId, event("tg-approver", { kind: "command", name: "approvals", args: "" }), newId());
    expect(fake.last().message?.blocks[0]).toMatchObject({ type: "header", tone: "info" });
    expect(title(fake.last().message)).toMatch(/Link your ERP account/);
  });

  it("links with a one-time code, then rejects reuse of the same code", async () => {
    const { code } = await links.createCode(connectionId, "ar", approver);
    await runtime.handleInbound(connectionId, event("tg-approver", { kind: "command", name: "start", args: code }), newId());
    expect(title(fake.last().message)).toBe("تم ربط حسابك");
    const link = await db.botIdentityLink.findFirstOrThrow({ where: { connectionId, userId: approver.id, revokedAt: null } });
    expect(link.externalUserId).toBe("tg-approver");
    expect(await db.auditLog.count({ where: { entityId: link.id, action: "bot_link.created" } })).toBe(1);

    await runtime.handleInbound(connectionId, event("tg-intruder", { kind: "command", name: "start", args: code }), newId());
    expect(await db.botIdentityLink.count({ where: { connectionId, externalUserId: "tg-intruder" } })).toBe(0);
  });

  it("drops a duplicate platform delivery", async () => {
    const before = fake.log.length;
    const dup = { ...event("tg-approver", { kind: "command", name: "menu", args: "" }), eventId: "qa:dup" } as InboundEvent;
    await runtime.handleInbound(connectionId, dup, newId());
    await runtime.handleInbound(connectionId, dup, newId());
    expect(fake.log.length).toBe(before + 1);
    // The menu reaches the client with opaque tokens only — no intent leaks into button ids.
    for (const id of actionIds(fake.last().message)) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("alerts the approver once, and approves from chat after a confirmation", async () => {
    await scheduler.tick();
    await scheduler.tick();
    const alerts = queued.filter((j) => j.kind === "alert" && j.alertType === "approval_requested");
    expect(alerts).toHaveLength(1); // the requester is excluded and the second scan sends nothing
    const alert = alerts[0];
    if (!alert) throw new Error("no alert");
    await scheduler.deliver(alert);
    const card = fake.last();
    expect(card.op).toBe("send");
    expect(title(card.message)).toBe("أمر شراء بانتظار موافقتك");

    // Someone else holding the button cannot use it.
    const { code } = await links.createCode(connectionId, "en", outsider);
    await runtime.handleInbound(connectionId, event("tg-outsider", { kind: "command", name: "start", args: code }), newId());
    const confirmToken = await tapIntent(card.message, "confirm");
    await runtime.handleInbound(connectionId, event("tg-outsider", { kind: "action", actionId: confirmToken }), newId());
    expect(title(fake.last().message)).toBe("This button belongs to another user.");

    await runtime.handleInbound(connectionId, event("tg-approver", { kind: "action", actionId: confirmToken }), newId());
    const confirm = fake.last();
    expect(title(confirm.message)).toBe("تأكيد الموافقة");
    const approveToken = await tapIntent(confirm.message, "approve");

    await runtime.handleInbound(connectionId, event("tg-approver", { kind: "action", actionId: approveToken }), newId());
    const order = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(order.status).toBe("APPROVED");
    expect(await db.auditLog.count({ where: { entityId: poId, action: "bot.purchase_order.approved" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: poId, action: "purchase_order.approved" } })).toBe(1);
    // The alert copy that was delivered earlier is edited to the final state.
    expect(fake.log.some((r) => r.op === "edit" && title(r.message) === "تمت الموافقة")).toBe(true);

    // A second tap on the single-use button does nothing.
    await runtime.handleInbound(connectionId, event("tg-approver", { kind: "action", actionId: approveToken }), newId());
    expect(title(fake.last().message)).toBe("تم تنفيذ هذا الإجراء مسبقًا.");
  });

  it("re-checks permission at tap time", async () => {
    await runtime.handleInbound(connectionId, event("tg-approver", { kind: "command", name: "menu", args: "" }), newId());
    denied.add(approver.id);
    try {
      await runtime.handleInbound(connectionId, event("tg-approver", { kind: "command", name: "approvals", args: "" }), newId());
      expect(fake.last().message?.blocks[0]).toMatchObject({ type: "header", tone: "danger" });
    } finally {
      denied.delete(approver.id);
    }
  });

  it("asks for a rejection reason with a reply prompt on platforms without modals", async () => {
    const otherPo = newId();
    const approvalId = newId();
    const supplier = await db.party.findFirstOrThrow({ where: { companyId } });
    await db.approvalRequest.create({ data: { id: approvalId, companyId, subjectType: "purchase_order", subjectId: otherPo, amount: "100", currency: "SAR", requestedBy: requester.id, correlationId: newId() } });
    await db.purchaseOrder.create({
      data: { id: otherPo, companyId, number: "PO-QA-2", supplierId: supplier.id, status: "PENDING_APPROVAL", orderDate: new Date("2026-11-15"), currency: "SAR", totalAmount: "100", approvalRequestId: approvalId, requestedBy: requester.id, correlationId: newId() },
    });
    await runtime.handleInbound(connectionId, event("tg-approver", { kind: "command", name: "approvals", args: "" }), newId());
    const viewToken = await tapIntent(fake.last().message, "view");
    await runtime.handleInbound(connectionId, event("tg-approver", { kind: "action", actionId: viewToken }), newId());
    const rejectToken = await tapIntent(fake.last().message, "reject");
    await runtime.handleInbound(connectionId, event("tg-approver", { kind: "action", actionId: rejectToken }), newId());
    expect(fake.last().op).toBe("prompt");
    await runtime.handleInbound(connectionId, event("tg-approver", { kind: "text", text: "Price too high" }), newId());
    const order = await db.purchaseOrder.findUniqueOrThrow({ where: { id: otherPo } });
    expect(order.status).toBe("REJECTED");
    const request = await db.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } });
    expect(request.reason).toBe("Price too high");
  });

  it("ignores a revoked link", async () => {
    await connections.revokeLink(connectionId, (await db.botIdentityLink.findFirstOrThrow({ where: { connectionId, userId: outsider.id, revokedAt: null } })).id, approver, newId());
    await runtime.handleInbound(connectionId, event("tg-outsider", { kind: "command", name: "menu", args: "" }), newId());
    expect(title(fake.last().message)).toMatch(/Link your ERP account/);
  });
});
