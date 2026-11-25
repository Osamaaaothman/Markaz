import {
  buildSystemPrompt,
  compactionCut,
  createChatModel,
  DEFAULT_COMPACTION,
  summarizeForCompaction,
  type CompactionLimits,
  executeDecisions,
  fromStored,
  outcomesMessage,
  PartialRunError,
  permittedTools,
  refsIn,
  resolveRefs,
  runAssistant,
  textOf,
  toolsForMode,
  LOAD_TOOLS,
  sectionOf,
  sectionOfRoute,
  toStored,
  trimHistory,
  shrinkOldToolResults,
  type AssistantEvent,
  type AssistantMode,
  type Decision,
  type DisplayBlock,
  type ErpTool,
  type ItemOutcome,
  type Locale,
  type ProposedItem,
  type RunResult,
  type ToolContext,
} from "@erp/ai";
import type { AttachmentService, IAuditLogger, IPermissionService } from "@erp/core";
import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { humanWithFile, prepareFiles, type ChatFileRef } from "./ai-files.js";
import { AiSettingsError, providerErrorCode, providerErrorLogDetail, type AiSettingsService } from "./ai-settings.service.js";

export class AiChatError extends Error {
  constructor(readonly code: "FORBIDDEN" | "CONVERSATION_NOT_FOUND" | "NOTHING_TO_DECIDE" | "LIMIT_REACHED" | "MESSAGE_TOO_LONG" | "AUTO_MODE_OFF" | "TURN_RUNNING" | "FILES_UNAVAILABLE" | "CHANGE_NOT_FOUND" | "INVALID_ARGUMENTS", readonly detail?: string) {
    super(code);
    this.name = "AiChatError";
  }
}

export interface Actor {
  readonly id: string;
  readonly companyId: string;
}

// Events streamed to the browser: the engine's events plus bookkeeping ones.
export type ChatEvent =
  | AssistantEvent
  | { readonly type: "conversation"; readonly id: string; readonly title: string }
  | { readonly type: "outcome"; readonly outcome: ItemOutcomeView }
  | { readonly type: "compacted"; readonly compactions: number }
  | { readonly type: "done"; readonly messageId: string; readonly status: "IDLE" | "AWAITING_APPROVAL"; readonly usage: { input: number; output: number } }
  | { readonly type: "error"; readonly code: string };

export type ItemOutcomeView =
  | { readonly key: string; readonly status: "EXECUTED"; readonly link: { label: string; path: string } | null }
  | { readonly key: string; readonly status: "REJECTED" | "SKIPPED" }
  | { readonly key: string; readonly status: "FAILED"; readonly errorCode: string };

export interface SendInput {
  readonly conversationId?: string | undefined;
  readonly text: string;
  readonly mode: AssistantMode;
  readonly locale: Locale;
  readonly page?: { readonly route: string; readonly entityId?: string | undefined } | undefined;
  // One attached document (PDF or picture), read by the model and kept for attaching to a record later.
  readonly file?: { readonly name: string; readonly bytes: Uint8Array } | undefined;
}

export interface ExternalWriteResult {
  readonly status: "EXECUTED" | "PROPOSED";
  readonly id: string;
  readonly conversationId: string;
  readonly data: Record<string, unknown> | null;
  readonly link: { label: string; path: string } | null;
  readonly warnings: readonly string[];
}

export interface McpActivityItem {
  readonly id: string;
  readonly key: string;
  readonly conversationId: string;
  readonly tokenName: string;
  readonly tool: string;
  readonly status: string;
  readonly titleKey: string | null;
  readonly createdAt: Date;
}

export interface DecideInput {
  readonly conversationId: string;
  readonly decisions: Readonly<Record<string, Decision>>;
  readonly edits?: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined;
  readonly locale: Locale;
}

const MAX_MESSAGE = 4000;

// Orchestrates one chat turn: permissions → history → engine (packages/ai) → persistence.
// The engine never touches the database; this class never decides what the model may do.
type ProviderSettings = Parameters<typeof createChatModel>[0];
// Backup models on the same provider and key, tried in order when the main one is busy (503/429).
// AI_FALLBACK_MODELS overrides them (comma-separated; "none" turns this off). Gemini's free tier is
// often overloaded, so it has defaults.
const DEFAULT_FALLBACKS: Readonly<Partial<Record<ProviderSettings["provider"], readonly string[]>>> = {
  // Google retires models for new keys (gemini-2.5-flash-lite: 404 "no longer available to new users");
  // the -latest alias always points at a current model, and a retired backup is skipped anyway.
  google: ["gemini-flash-lite-latest", "gemini-flash-latest"],
};
export function fallbackModelNames(provider: ProviderSettings, env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env["AI_FALLBACK_MODELS"]?.trim();
  if (raw === "none") return [];
  const names = raw ? raw.split(",").map((m) => m.trim()).filter(Boolean) : [...(DEFAULT_FALLBACKS[provider.provider] ?? [])];
  return [...new Set(names)].filter((m) => m !== provider.model);
}

export class AiChatService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly permissions: IPermissionService,
    private readonly audit: IAuditLogger,
    private readonly settings: AiSettingsService,
    private readonly tools: readonly ErpTool[],
    // Swappable so tests can run the whole flow with a scripted model and no network.
    private readonly modelFactory: typeof createChatModel = createChatModel,
    private readonly compaction: CompactionLimits = compactionFromEnv(),
    private readonly files: Pick<AttachmentService, "stage" | "readStaged"> | null = null,
  ) {}

  // Turns in progress, by conversation. A turn belongs to the server, not to the browser tab: a
  // refresh or a closed page does not stop it (only stop() does), and the result is saved as usual.
  // REVIEW: in-memory, so it is per API process. With several API replicas, "running" and stop()
  // only see turns on the same process — fine for the single-container deployment we ship.
  private readonly running = new Map<string, AbortController>();

  private beginTurn(conversationId: string): AbortController {
    if (this.running.has(conversationId)) throw new AiChatError("TURN_RUNNING");
    const ctrl = new AbortController();
    this.running.set(conversationId, ctrl);
    return ctrl;
  }

  private endTurn(conversationId: string, ctrl: AbortController): void {
    if (this.running.get(conversationId) === ctrl) this.running.delete(conversationId);
  }

  isRunning(conversationId: string): boolean {
    return this.running.has(conversationId);
  }

  async stop(actor: Actor, conversationId: string): Promise<{ stopped: boolean }> {
    await this.ownConversation(actor, conversationId);
    const ctrl = this.running.get(conversationId);
    ctrl?.abort();
    return { stopped: Boolean(ctrl) };
  }

  private can(actor: Actor, resource: string, action: string): Promise<boolean> {
    return this.permissions.can(actor.id, action, resource, actor.companyId);
  }

  private async requireMode(actor: Actor, mode: AssistantMode): Promise<void> {
    if (!(await this.can(actor, "ai_assistant", "use"))) throw new AiChatError("FORBIDDEN");
    if (mode !== "ask" && !(await this.can(actor, "ai_assistant", "interact"))) throw new AiChatError("FORBIDDEN");
  }

  private toolContext(actor: Actor, conversationId: string, locale: Locale): ToolContext {
    return {
      actor: { userId: actor.id, companyId: actor.companyId },
      locale,
      conversationId,
      // Every audit row written through the assistant carries this prefix, so the audit log can
      // show that a change came from the assistant (and from which conversation).
      correlationId: `ai:${conversationId}`,
      can: (resource, action) => this.can(actor, resource, action),
    };
  }

  async send(actor: Actor, input: SendInput, emit: (e: ChatEvent) => void): Promise<void> {
    const text = input.text.trim();
    if (text.length === 0 || text.length > MAX_MESSAGE) throw new AiChatError("MESSAGE_TOO_LONG");
    await this.requireMode(actor, input.mode);
    const config = await this.settings.resolve(actor.companyId);
    await this.checkLimit(actor.companyId, config.monthlyTokenLimit);
    const autoAllowed = input.mode === "auto" && config.autoModeEnabled && (await this.can(actor, "ai_assistant", "auto"));
    if (input.mode === "auto" && !autoAllowed) throw new AiChatError("AUTO_MODE_OFF");

    const conversation = input.conversationId
      ? await this.ownConversation(actor, input.conversationId)
      : await this.prisma.aiConversation.create({ data: { id: newId(), companyId: actor.companyId, userId: actor.id, title: text.slice(0, 80), mode: input.mode } });
    emit({ type: "conversation", id: conversation.id, title: conversation.title });

    const ctrl = this.beginTurn(conversation.id);
    try {
      // Cards still waiting stay open: the user may answer a question first and approve them after.
      // The model is told which cards wait (system prompt), so it never treats them as done or dropped.

      await this.compactIfNeeded(actor, conversation.id, config.provider, emit, ctrl.signal);
      const history = await this.history(conversation.id);
      let human: BaseMessage = new HumanMessage(text);
      let uiBlocks: unknown[] | undefined;
      if (input.file) {
        if (!this.files) throw new AiChatError("FILES_UNAVAILABLE");
        const ref: ChatFileRef = { id: `f${newId().slice(0, 8)}`, ...(await this.files.stage(input.file.name, input.file.bytes)) };
        human = humanWithFile(text, ref);
        uiBlocks = [{ kind: "upload", name: ref.originalName, contentType: ref.contentType, sizeBytes: ref.sizeBytes }];
      }
      await this.appendRows(conversation.id, actor.companyId, [{ role: "human", payload: toStored([human])[0], visible: true, uiText: text, ...(uiBlocks ? { uiBlocks } : {}) }]);
      const messages = await prepareFiles([...history, human], this.readFile);

      await this.runTurn(actor, conversation.id, conversation.nextItemNumber, input.mode, autoAllowed, input.locale, messages, input.page, config.provider, emit, ctrl.signal);
    } finally {
      this.endTurn(conversation.id, ctrl);
    }
  }

  async decide(actor: Actor, input: DecideInput, emit: (e: ChatEvent) => void): Promise<void> {
    const conversation = await this.ownConversation(actor, input.conversationId);
    await this.requireMode(actor, conversation.mode as AssistantMode);
    const ctrl = this.beginTurn(conversation.id);
    try {
      await this.decideTurn(actor, conversation, input, emit, ctrl.signal);
    } finally {
      this.endTurn(conversation.id, ctrl);
    }
  }

  private async decideTurn(actor: Actor, conversation: Awaited<ReturnType<AiChatService["ownConversation"]>>, input: DecideInput, emit: (e: ChatEvent) => void, signal: AbortSignal): Promise<void> {
    // Claim the decision atomically: a double click or a second tab cannot run the same items twice.
    const claimed = await this.prisma.aiConversation.updateMany({ where: { id: conversation.id, status: "AWAITING_APPROVAL" }, data: { status: "IDLE" } });
    if (claimed.count !== 1) throw new AiChatError("NOTHING_TO_DECIDE");

    const rows = await this.prisma.aiChangeItem.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" } });
    // Only the cards the user decided now; other waiting cards (e.g. from another message) stay open.
    const pending = rows.filter((r) => r.status === "PROPOSED" && input.decisions[r.itemKey] !== undefined);
    if (pending.length === 0) {
      await this.refreshStatus(conversation.id);
      throw new AiChatError("NOTHING_TO_DECIDE");
    }
    const prior = new Map(rows.filter((r) => r.status === "EXECUTED" && r.result).map((r) => [r.itemKey, (r.result as { data?: Record<string, unknown> }).data ?? {}]));
    const items: ProposedItem[] = pending.map((r) => ({ id: r.itemKey, toolCallId: "", tool: r.tool, args: r.args as Record<string, unknown>, preview: r.preview as unknown as ProposedItem["preview"], risk: r.risk as "low" | "high", dependsOn: r.dependsOn }));
    const ctx = this.toolContext(actor, conversation.id, input.locale);

    const outcomes = await executeDecisions({
      items,
      decisions: input.decisions,
      ...(input.edits ? { edits: input.edits } : {}),
      tools: this.tools,
      ctx,
      priorResults: prior,
      onOutcome: (o) => emit({ type: "outcome", outcome: outcomeView(o) }),
    });
    await this.recordOutcomes(actor, pending, outcomes);

    // Let the model tell the user, in plain words, what happened.
    const config = await this.settings.resolve(actor.companyId);
    const notice = outcomesMessage(outcomes);
    const history = await prepareFiles(await this.history(conversation.id), this.readFile);
    await this.appendRows(conversation.id, actor.companyId, [{ role: "human", payload: toStored([notice])[0], visible: false }]);
    await this.runTurn(actor, conversation.id, conversation.nextItemNumber, conversation.mode as AssistantMode, false, input.locale, [...history, notice], undefined, config.provider, emit, signal);
  }

  // One card decided outside the chat (the notification dialog): it runs exactly like an approval in the
  // chat, but no model reply is written, so it costs no tokens and works with the assistant switched off.
  // A hidden notice records the outcome, so the model knows about it if the conversation continues.
  async decideOne(actor: Actor, input: { conversationId: string; key: string; decision: Decision; locale: Locale }): Promise<ItemOutcomeView> {
    const conversation = await this.ownConversation(actor, input.conversationId);
    await this.requireMode(actor, conversation.mode === "ask" ? "review" : (conversation.mode as AssistantMode));
    const ctrl = this.beginTurn(conversation.id);
    try {
      const rows = await this.prisma.aiChangeItem.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" } });
      const row = rows.find((r) => r.itemKey === input.key && r.status === "PROPOSED");
      if (!row) throw new AiChatError("NOTHING_TO_DECIDE");
      const prior = new Map(rows.filter((r) => r.status === "EXECUTED" && r.result).map((r) => [r.itemKey, (r.result as { data?: Record<string, unknown> }).data ?? {}]));
      const item: ProposedItem = { id: row.itemKey, toolCallId: "", tool: row.tool, args: row.args as Record<string, unknown>, preview: row.preview as unknown as ProposedItem["preview"], risk: row.risk as "low" | "high", dependsOn: row.dependsOn };
      const outcomes = await executeDecisions({ items: [item], decisions: { [row.itemKey]: input.decision }, tools: this.tools, ctx: this.toolContext(actor, conversation.id, input.locale), priorResults: prior });
      await this.recordOutcomes(actor, [row], outcomes);
      await this.appendRows(conversation.id, actor.companyId, [{ role: "human", payload: toStored([outcomesMessage(outcomes)])[0], visible: false }]);
      await this.refreshStatus(conversation.id);
      const outcome = outcomes[0];
      if (!outcome) throw new AiChatError("NOTHING_TO_DECIDE");
      return outcomeView(outcome);
    } finally {
      this.endTurn(conversation.id, ctrl);
    }
  }

  private async runTurn(
    actor: Actor,
    conversationId: string,
    firstItemNumber: number,
    mode: AssistantMode,
    autoAllowed: boolean,
    locale: Locale,
    messages: BaseMessage[],
    page: SendInput["page"],
    provider: Awaited<ReturnType<AiSettingsService["resolve"]>>["provider"],
    emit: (e: ChatEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const ctx = this.toolContext(actor, conversationId, locale);
    const tools = await permittedTools(toolsForMode(this.tools, mode), ctx);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { name: true, nameAr: true, defaultCurrency: true, timezone: true } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { email: true, roles: { select: { role: { select: { name: true } } } } } });
    const waiting = await this.prisma.aiChangeItem.findMany({ where: { conversationId, status: "PROPOSED" }, orderBy: { createdAt: "asc" }, select: { itemKey: true, tool: true, preview: true } });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: company.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const memory = (await this.prisma.aiConversation.findUnique({ where: { id: conversationId }, select: { summary: true } }))?.summary ?? null;
    const system = buildSystemPrompt({
      memory,
      mode,
      locale,
      today,
      companyName: locale === "ar" && company.nameAr ? company.nameAr : company.name,
      currency: company.defaultCurrency,
      userName: user.email,
      page,
      roles: user.roles.map((r) => r.role.name),
      pending: waiting.map((w) => ({ id: w.itemKey, tool: w.tool, summary: previewSummary(w.preview) })),
    });

    // Collect what the UI needs to redraw this answer later (blocks, the tool timeline).
    const blocks: Array<DisplayBlock | { kind: "clarify"; question: string; options: readonly string[] } | { kind: "needsMode" }> = [];
    const timeline: Array<{ tool: string; ok: boolean; ms: number; errorCode?: string }> = [];
    const relay = (e: AssistantEvent): void => {
      if (e.type === "display") blocks.push(e.block);
      if (e.type === "clarify") blocks.push({ kind: "clarify", question: e.question, options: e.options });
      if (e.type === "needs_mode") blocks.push({ kind: "needsMode" });
      if (e.type === "tool_end") timeline.push({ tool: e.tool, ok: e.ok, ms: e.ms, ...(e.errorCode ? { errorCode: e.errorCode } : {}) });
      emit(e);
    };

    let result: RunResult;
    try {
      const backups = fallbackModelNames(provider);
      // With backups, fail fast on the main model instead of waiting out client retries.
      const model = await this.modelFactory(backups.length ? { ...provider, retries: 0 } : provider);
      const fallbackModels = await Promise.all(backups.map((m) => this.modelFactory({ ...provider, model: m })));
      const priorRows = await this.prisma.aiChangeItem.findMany({ where: { conversationId, status: "EXECUTED" }, select: { itemKey: true, result: true } });
      // Recent window only, and earlier turns' tool data shortened (the current turn's stays whole).
      const history = shrinkOldToolResults(trimHistory(messages));
      result = await runAssistant({
        model,
        tools,
        // Only the sections this conversation and page need are sent; the model loads others on demand.
        initialSections: startingSections(history, page?.route, waiting.map((w) => w.tool)),
        mode,
        autoAllowed,
        ctx,
        system,
        messages: history,
        firstItemNumber,
        priorResults: new Map(priorRows.map((r) => [r.itemKey, ((r.result as { data?: Record<string, unknown> } | null)?.data) ?? {}])),
        emit: relay,
        fallbackModels,
        pendingIds: waiting.map((w) => w.itemKey),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      const cause = error instanceof PartialRunError ? error.cause : error;
      const code = cause instanceof AiSettingsError ? cause.code : providerErrorCode(cause);
      // Plain console: this file stays free of Nest imports so its specs run under the plain Jest config.
      console.warn(JSON.stringify({ level: "warn", event: "ai.turn_failed", code, conversationId, provider: provider.provider, model: provider.model, steps: timeline.length, partial: error instanceof PartialRunError, ...providerErrorLogDetail(cause) }));
      if (error instanceof PartialRunError) {
        // Cards were already shown (and auto changes already ran) before the model failed: save them,
        // so the cards on screen are real and can be approved, and the error shows under them.
        emit({ type: "error", code });
        await this.finishTurn(actor, conversationId, firstItemNumber, mode, error.partial, blocks, timeline, provider, code, emit);
        return;
      }
      const id = await this.appendNotice(conversationId, actor.companyId, null, blocks, timeline, provider, { input: 0, output: 0 }, code);
      // Cards from earlier messages may still wait; the status must say so.
      const status = await this.refreshStatus(conversationId);
      emit({ type: "error", code });
      emit({ type: "done", messageId: id, status, usage: { input: 0, output: 0 } });
      return;
    }
    await this.finishTurn(actor, conversationId, firstItemNumber, mode, result, blocks, timeline, provider, result.hitStepLimit ? "STEP_LIMIT" : null, emit);
  }

  // Saves a turn's result: hidden history rows, the visible notice, its cards, and the status.
  private async finishTurn(
    actor: Actor,
    conversationId: string,
    firstItemNumber: number,
    mode: AssistantMode,
    result: RunResult,
    blocks: readonly unknown[],
    timeline: readonly unknown[],
    provider: { provider: string; model: string },
    errorCode: string | null,
    emit: (e: ChatEvent) => void,
  ): Promise<void> {
    // Hidden plumbing rows (AI tool calls, tool results, the final AI message) keep the exact
    // LangChain history; one visible "notice" row carries what the user sees.
    await this.appendRows(conversationId, actor.companyId, result.newMessages.map((m) => ({ role: m.getType() === "ai" ? "ai" : m.getType() === "tool" ? "tool" : "human", payload: toStored([m])[0], visible: false })));
    const finalAi = [...result.newMessages].reverse().find((m) => m.getType() === "ai" && !((m as { tool_calls?: unknown[] }).tool_calls?.length));
    const answer = finalAi ? textOf(finalAi.content) : null;
    const messageId = await this.appendNotice(conversationId, actor.companyId, answer, blocks, timeline, provider, result.usage, errorCode);

    // Cards the model replaced with a corrected version are closed (skipped), never run.
    if (result.withdrawn.length > 0) {
      const gone = await this.prisma.aiChangeItem.findMany({ where: { conversationId, status: "PROPOSED", itemKey: { in: result.withdrawn } }, select: { id: true, itemKey: true, tool: true } });
      await this.recordOutcomes(actor, gone, gone.map((g) => ({ id: g.itemKey, status: "skipped" as const, reason: "DEPENDS_ON_UNEXECUTED" as const })));
      for (const id of result.withdrawn) emit({ type: "outcome", outcome: { key: id, status: "SKIPPED" } });
    }
    const stillWaiting = await this.prisma.aiChangeItem.count({ where: { conversationId, status: "PROPOSED" } });
    const status = result.proposals.length > 0 || stillWaiting > 0 ? "AWAITING_APPROVAL" : "IDLE";
    await this.prisma.$transaction([
      ...result.proposals.map((p) =>
        this.prisma.aiChangeItem.create({
          data: { id: newId(), companyId: actor.companyId, conversationId, messageId, itemKey: p.id, tool: p.tool, args: p.args as Prisma.InputJsonValue, preview: p.preview as unknown as Prisma.InputJsonValue, risk: p.risk, dependsOn: [...p.dependsOn] },
        }),
      ),
      ...result.executed.map((x) =>
        this.prisma.aiChangeItem.create({
          data: {
            id: newId(), companyId: actor.companyId, conversationId, messageId, itemKey: x.id, tool: x.tool, args: x.args as Prisma.InputJsonValue, preview: {}, risk: "low",
            dependsOn: [], status: "EXECUTED", auto: true, result: { data: x.result.data } as Prisma.InputJsonValue, link: (x.result.link ?? Prisma.JsonNull) as Prisma.InputJsonValue, decidedBy: actor.id, decidedAt: new Date(),
          },
        }),
      ),
      this.prisma.aiConversation.update({
        where: { id: conversationId },
        data: { status, mode, nextItemNumber: firstItemNumber + result.proposals.length + result.executed.length },
      }),
    ]);
    await this.recordUsage(actor, result.usage);
    for (const x of result.executed) {
      await this.audit.log({ actorId: actor.id, action: "ai_change.auto_executed", entityType: "AiConversation", entityId: conversationId, after: { item: x.id, tool: x.tool }, correlationId: `ai:${conversationId}` });
    }
    emit({ type: "done", messageId, status, usage: result.usage });
  }

  private async recordOutcomes(actor: Actor, pending: ReadonlyArray<{ id: string; itemKey: string; tool: string }>, outcomes: readonly ItemOutcome[]): Promise<void> {
    const byKey = new Map(pending.map((p) => [p.itemKey, p]));
    const now = new Date();
    for (const o of outcomes) {
      const row = byKey.get(o.id);
      if (!row) continue;
      const base = { decidedBy: actor.id, decidedAt: now };
      const data =
        o.status === "executed"
          ? { ...base, status: "EXECUTED", args: o.args as Prisma.InputJsonValue, result: { data: o.result.data } as Prisma.InputJsonValue, link: (o.result.link ?? Prisma.JsonNull) as Prisma.InputJsonValue }
          : o.status === "failed"
            ? { ...base, status: "FAILED", errorCode: o.errorCode }
            : { ...base, status: o.status === "rejected" ? "REJECTED" : "SKIPPED" };
      await this.prisma.aiChangeItem.update({ where: { id: row.id }, data });
      await this.audit.log({ actorId: actor.id, action: `ai_change.${o.status}`, entityType: "AiChangeItem", entityId: row.id, after: { item: o.id, tool: row.tool }, correlationId: `ai:${row.id}` });
    }
  }

  // AWAITING_APPROVAL exactly while any card in the conversation still waits.
  private async refreshStatus(conversationId: string): Promise<"IDLE" | "AWAITING_APPROVAL"> {
    const waiting = await this.prisma.aiChangeItem.count({ where: { conversationId, status: "PROPOSED" } });
    const status = waiting > 0 ? "AWAITING_APPROVAL" : "IDLE";
    await this.prisma.aiConversation.update({ where: { id: conversationId }, data: { status } });
    return status;
  }

  private async ownConversation(actor: Actor, id: string) {
    const c = await this.prisma.aiConversation.findFirst({ where: { id, companyId: actor.companyId, userId: actor.id } });
    if (!c) throw new AiChatError("CONVERSATION_NOT_FOUND");
    return c;
  }

  // What the model sees: only the messages after the compacted part (the summary goes in the system prompt).
  private async history(conversationId: string): Promise<BaseMessage[]> {
    const c = await this.prisma.aiConversation.findUniqueOrThrow({ where: { id: conversationId }, select: { summaryThroughSeq: true } });
    const rows = await this.prisma.aiMessage.findMany({ where: { conversationId, role: { not: "notice" }, seq: { gt: c.summaryThroughSeq } }, orderBy: { seq: "asc" }, select: { payload: true } });
    return fromStored(rows.map((r) => r.payload));
  }

  // When the conversation has grown past the limit, fold its older part into the running summary.
  // A failure here never blocks the user's message: the history is then just trimmed as before.
  private async compactIfNeeded(actor: Actor, conversationId: string, provider: Awaited<ReturnType<AiSettingsService["resolve"]>>["provider"], emit: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
    const c = await this.prisma.aiConversation.findUniqueOrThrow({ where: { id: conversationId }, select: { summary: true, summaryThroughSeq: true, compactions: true } });
    const rows = await this.prisma.aiMessage.findMany({ where: { conversationId, role: { not: "notice" }, seq: { gt: c.summaryThroughSeq } }, orderBy: { seq: "asc" }, select: { seq: true, payload: true } });
    const messages = await prepareFiles(fromStored(rows.map((r) => r.payload)), null);
    const cut = compactionCut(messages, this.compaction);
    if (cut === null) return;
    try {
      const model = await this.modelFactory(provider);
      const summary = await summarizeForCompaction(model, c.summary, messages.slice(0, cut), signal);
      const through = rows[cut - 1]?.seq;
      if (!summary || through === undefined) return;
      await this.prisma.aiConversation.update({ where: { id: conversationId }, data: { summary, summaryThroughSeq: through, compactions: { increment: 1 } } });
      // A visible divider so the user knows the assistant now works from a summary of what came before.
      await this.appendRows(conversationId, actor.companyId, [{ role: "notice", payload: { compacted: true }, visible: true }]);
      emit({ type: "compacted", compactions: c.compactions + 1 });
    } catch {
      // Ignored on purpose: trimHistory still bounds what is sent.
    }
  }

  // The bytes of a staged chat file, or null if it can no longer be read (the model is then told so).
  private readonly readFile = async (f: ChatFileRef): Promise<Uint8Array | null> => {
    try {
      return this.files ? await this.files.readStaged(f) : null;
    } catch {
      return null;
    }
  };

  private async appendRows(conversationId: string, companyId: string, rows: ReadonlyArray<{ role: string; payload: unknown; visible: boolean; uiText?: string; uiBlocks?: unknown[] }>): Promise<void> {
    if (rows.length === 0) return;
    const last = await this.prisma.aiMessage.findFirst({ where: { conversationId }, orderBy: { seq: "desc" }, select: { seq: true } });
    let seq = (last?.seq ?? 0) + 1;
    await this.prisma.aiMessage.createMany({
      data: rows.map((r) => ({ id: newId(), conversationId, companyId, seq: seq++, role: r.role, payload: r.payload as Prisma.InputJsonValue, visible: r.visible, uiText: r.uiText ?? null, ...(r.uiBlocks ? { uiBlocks: r.uiBlocks as Prisma.InputJsonValue } : {}) })),
    });
  }

  private async appendNotice(
    conversationId: string,
    companyId: string,
    text: string | null,
    blocks: readonly unknown[],
    timeline: readonly unknown[],
    provider: { provider: string; model: string },
    usage: { input: number; output: number },
    errorCode: string | null,
  ): Promise<string> {
    const id = newId();
    const last = await this.prisma.aiMessage.findFirst({ where: { conversationId }, orderBy: { seq: "desc" }, select: { seq: true } });
    await this.prisma.aiMessage.create({
      data: {
        id, conversationId, companyId, seq: (last?.seq ?? 0) + 1, role: "notice", payload: errorCode ? { errorCode } : {}, visible: true,
        uiText: text, uiBlocks: blocks as Prisma.InputJsonValue, uiTimeline: timeline as Prisma.InputJsonValue,
        provider: provider.provider, model: provider.model, inputTokens: usage.input, outputTokens: usage.output,
      },
    });
    return id;
  }

  private async recordUsage(actor: Actor, usage: { input: number; output: number }): Promise<void> {
    const day = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    await this.prisma.aiUsageDaily.upsert({
      where: { companyId_userId_day: { companyId: actor.companyId, userId: actor.id, day } },
      create: { companyId: actor.companyId, userId: actor.id, day, requests: 1, inputTokens: usage.input, outputTokens: usage.output },
      update: { requests: { increment: 1 }, inputTokens: { increment: usage.input }, outputTokens: { increment: usage.output } },
    });
  }

  private async checkLimit(companyId: string, limit: number | null): Promise<void> {
    if (limit === null) return;
    const used = await this.monthUsage(companyId);
    if (used.input + used.output >= limit) throw new AiChatError("LIMIT_REACHED");
  }

  async monthUsage(companyId: string, userId?: string): Promise<{ input: number; output: number; requests: number }> {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const agg = await this.prisma.aiUsageDaily.aggregate({ where: { companyId, day: { gte: from }, ...(userId ? { userId } : {}) }, _sum: { inputTokens: true, outputTokens: true, requests: true } });
    return { input: agg._sum.inputTokens ?? 0, output: agg._sum.outputTokens ?? 0, requests: agg._sum.requests ?? 0 };
  }

  // ─── Conversation list and history for the UI ───────────────────────────────────────────────
  async list(actor: Actor) {
    return this.prisma.aiConversation.findMany({
      where: { companyId: actor.companyId, userId: actor.id, archivedAt: null },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: 100,
      select: { id: true, title: true, mode: true, status: true, pinned: true, updatedAt: true },
    }).then((rows) => rows.map((r) => ({ ...r, running: this.running.has(r.id) })));
  }

  // ─── Writes from an external MCP client (Claude Desktop / Claude Code) ──────────────────────
  // The client calls a write tool directly; nothing runs through our model. The change is a card in
  // the token's own conversation ("MCP · <token name>"), decided in the app exactly like a chat card.
  // A "write" token is full access: every change, high-risk included, runs at once and is recorded as an
  // executed card. The approval step belongs to the MCP client (it asks its user before each tool call),
  // not to the app. Only the user's own ai_assistant:auto permission and the tool's permission apply.
  async externalWrite(
    actor: Actor,
    token: { id: string; name: string; scope: "review" | "write" },
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ExternalWriteResult> {
    const tool = this.tools.find((t) => t.name === toolName);
    if (!tool || tool.kind !== "write") throw new AiChatError("CHANGE_NOT_FOUND");
    await this.requireMode(actor, token.scope === "write" ? "auto" : "review");
    const conversationId = await this.tokenConversation(actor, token);
    if (this.running.has(conversationId)) throw new AiChatError("TURN_RUNNING");
    const ctx = this.toolContext(actor, conversationId, "en");
    if (!(await ctx.can(tool.permission.resource, tool.permission.action))) throw new AiChatError("FORBIDDEN");

    // "$ref:c1.id" may point at an earlier card of this conversation, as in the chat.
    const items = await this.prisma.aiChangeItem.findMany({ where: { conversationId, status: { in: ["PROPOSED", "EXECUTED"] } }, select: { itemKey: true, status: true, result: true } });
    const known = new Map(items.filter((i) => i.status === "EXECUTED").map((i) => [i.itemKey, ((i.result as { data?: Record<string, unknown> } | null)?.data) ?? {}]));
    const waiting = new Set(items.filter((i) => i.status === "PROPOSED").map((i) => i.itemKey));
    const refs = refsIn(args);
    const unknown = refs.find((r) => !known.has(r) && !waiting.has(r));
    if (unknown) throw new AiChatError("INVALID_ARGUMENTS", `UNKNOWN_REFERENCE ${unknown}`);
    const pendingRef = refs.some((r) => !known.has(r));
    const parsed = tool.input.safeParse(pendingRef ? args : resolveRefs(args, known));
    if (!parsed.success && !pendingRef) throw new AiChatError("INVALID_ARGUMENTS", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 500));
    const checked = parsed.success && !pendingRef ? (parsed.data as Record<string, unknown>) : args;
    const preview = await tool.preview(ctx, checked);

    if (token.scope === "write" && !(await this.can(actor, "ai_assistant", "auto"))) throw new AiChatError("FORBIDDEN");
    // A reference to a card still waiting (from an earlier review token) cannot run yet: that one becomes a card too.
    const runNow = token.scope === "write" && !pendingRef;
    // Atomic: two calls at once never get the same card number.
    const numbered = await this.prisma.aiConversation.update({ where: { id: conversationId }, data: { nextItemNumber: { increment: 1 } }, select: { nextItemNumber: true } });
    const key = `c${numbered.nextItemNumber - 1}`;
    const messageId = await this.appendNotice(conversationId, actor.companyId, null, [], [], { provider: "mcp", model: token.name }, { input: 0, output: 0 }, null);

    if (runNow) {
      const result = await tool.execute(ctx, checked);
      await this.prisma.aiChangeItem.create({
        data: {
          id: newId(), companyId: actor.companyId, conversationId, messageId, itemKey: key, tool: tool.name, args: checked as Prisma.InputJsonValue, preview: preview as unknown as Prisma.InputJsonValue, risk: tool.risk,
          dependsOn: [], status: "EXECUTED", auto: true, result: { data: result.data } as Prisma.InputJsonValue, link: (result.link ?? Prisma.JsonNull) as Prisma.InputJsonValue, decidedBy: actor.id, decidedAt: new Date(),
        },
      });
      await this.audit.log({ actorId: actor.id, action: "ai_change.auto_executed", entityType: "AiConversation", entityId: conversationId, after: { item: key, tool: tool.name, via: "mcp", token: token.id }, correlationId: `ai:${conversationId}` });
      return { status: "EXECUTED", id: key, conversationId, data: result.data, link: result.link ?? null, warnings: preview.warningKeys ?? [] };
    }
    await this.prisma.aiChangeItem.create({
      data: { id: newId(), companyId: actor.companyId, conversationId, messageId, itemKey: key, tool: tool.name, args: checked as Prisma.InputJsonValue, preview: preview as unknown as Prisma.InputJsonValue, risk: tool.risk, dependsOn: refs },
    });
    await this.prisma.aiConversation.update({ where: { id: conversationId }, data: { status: "AWAITING_APPROVAL" } });
    await this.audit.log({ actorId: actor.id, action: "ai_change.proposed", entityType: "AiConversation", entityId: conversationId, after: { item: key, tool: tool.name, via: "mcp", token: token.id }, correlationId: `ai:${conversationId}` });
    return { status: "PROPOSED", id: key, conversationId, data: null, link: null, warnings: preview.warningKeys ?? [] };
  }

  // The latest cards and changes that came in through the user's MCP tokens, for the notification bell.
  async mcpActivity(actor: Actor): Promise<McpActivityItem[]> {
    const tokens = await this.prisma.aiAccessToken.findMany({ where: { companyId: actor.companyId, userId: actor.id, conversationId: { not: null } }, select: { conversationId: true, name: true } });
    const byConversation = new Map(tokens.map((t) => [t.conversationId ?? "", t.name]));
    if (byConversation.size === 0) return [];
    const items = await this.prisma.aiChangeItem.findMany({
      where: { companyId: actor.companyId, conversationId: { in: [...byConversation.keys()] }, conversation: { userId: actor.id } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, itemKey: true, conversationId: true, tool: true, status: true, preview: true, createdAt: true },
    });
    return items.map((i) => ({
      id: i.id,
      key: i.itemKey,
      conversationId: i.conversationId,
      tokenName: byConversation.get(i.conversationId) ?? "",
      tool: i.tool,
      status: i.status,
      titleKey: (i.preview as { titleKey?: string } | null)?.titleKey ?? null,
      createdAt: i.createdAt,
    }));
  }

  // The token's conversation, created on its first write (and again if the user deleted it).
  private async tokenConversation(actor: Actor, token: { id: string; name: string; scope: string }): Promise<string> {
    const row = await this.prisma.aiAccessToken.findUniqueOrThrow({ where: { id: token.id }, select: { conversationId: true } });
    if (row.conversationId) {
      const exists = await this.prisma.aiConversation.findFirst({ where: { id: row.conversationId, companyId: actor.companyId, userId: actor.id }, select: { id: true } });
      if (exists) return exists.id;
    }
    const created = await this.prisma.aiConversation.create({ data: { id: newId(), companyId: actor.companyId, userId: actor.id, title: `MCP · ${token.name}`.slice(0, 120), mode: token.scope === "write" ? "auto" : "review" } });
    // Two first calls at once: only one link wins; the other conversation is removed again.
    const linked = await this.prisma.aiAccessToken.updateMany({ where: { id: token.id, conversationId: row.conversationId }, data: { conversationId: created.id } });
    if (linked.count === 1) return created.id;
    await this.prisma.aiConversation.delete({ where: { id: created.id } });
    return (await this.prisma.aiAccessToken.findUniqueOrThrow({ where: { id: token.id }, select: { conversationId: true } })).conversationId ?? created.id;
  }

  // The edit form of a waiting card: the tool's input as JSON Schema plus the card's current values.
  async itemForm(actor: Actor, conversationId: string, key: string): Promise<{ schema: unknown; args: unknown }> {
    const { tool, row } = await this.waitingItem(actor, conversationId, key);
    return { schema: z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }), args: row.args };
  }

  // The user corrected a waiting card. The new values go through the tool's own schema and preview —
  // the same checks as a proposal — and the card shows the new preview before anything is approved.
  async reviseItem(actor: Actor, conversationId: string, key: string, args: Record<string, unknown>, locale: Locale): Promise<{ args: unknown; preview: unknown }> {
    const { tool, row } = await this.waitingItem(actor, conversationId, key);
    if (this.running.has(conversationId)) throw new AiChatError("TURN_RUNNING");
    const ctx = this.toolContext(actor, conversationId, locale);
    if (!(await ctx.can(tool.permission.resource, tool.permission.action))) throw new AiChatError("FORBIDDEN");
    // Links to other cards ($ref) may be kept but not invented.
    const refs = refsIn(args);
    if (refs.some((r) => !row.dependsOn.includes(r))) throw new AiChatError("INVALID_ARGUMENTS", "UNKNOWN_REFERENCE");
    const done = await this.prisma.aiChangeItem.findMany({ where: { conversationId, status: "EXECUTED" }, select: { itemKey: true, result: true } });
    const prior = new Map(done.map((r) => [r.itemKey, ((r.result as { data?: Record<string, unknown> } | null)?.data) ?? {}]));
    const pendingRef = refs.some((r) => !prior.has(r));
    const parsed = tool.input.safeParse(pendingRef ? args : resolveRefs(args, prior));
    if (!parsed.success && !pendingRef) throw new AiChatError("INVALID_ARGUMENTS", parsed.error.issues.map((i) => i.path.join(".")).join(", ").slice(0, 300));
    const checked = parsed.success && !pendingRef ? (parsed.data as Record<string, unknown>) : args;
    const preview = await tool.preview(ctx, checked);
    await this.prisma.aiChangeItem.update({ where: { id: row.id }, data: { args: checked as Prisma.InputJsonValue, preview: preview as unknown as Prisma.InputJsonValue } });
    await this.audit.log({ actorId: actor.id, action: "ai_change.edited", entityType: "AiChangeItem", entityId: row.id, after: { item: key, tool: row.tool, changed: changedKeys(row.args, checked) }, correlationId: `ai:${row.id}` });
    return { args: checked, preview };
  }

  private async waitingItem(actor: Actor, conversationId: string, key: string) {
    await this.ownConversation(actor, conversationId);
    const row = await this.prisma.aiChangeItem.findFirst({ where: { conversationId, itemKey: key, status: "PROPOSED" } });
    const tool = row ? this.tools.find((t) => t.name === row.tool) : undefined;
    if (!row || !tool || tool.kind !== "write") throw new AiChatError("CHANGE_NOT_FOUND");
    return { row, tool };
  }

  async get(actor: Actor, id: string) {
    const c = await this.ownConversation(actor, id);
    const [rows, changes] = await Promise.all([
      this.prisma.aiMessage.findMany({ where: { conversationId: id, visible: true }, orderBy: { seq: "asc" } }),
      this.prisma.aiChangeItem.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } }),
    ]);
    return {
      conversation: { id: c.id, title: c.title, mode: c.mode, status: c.status, pinned: c.pinned, running: this.running.has(c.id) },
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role === "human" ? "user" : (r.payload as { compacted?: boolean } | null)?.compacted ? "divider" : "assistant",
        text: r.uiText,
        blocks: r.uiBlocks ?? [],
        timeline: r.uiTimeline ?? [],
        errorCode: (r.payload as { errorCode?: string } | null)?.errorCode ?? null,
        createdAt: r.createdAt,
        changes: changes
          .filter((ch) => ch.messageId === r.id)
          .map((ch) => ({ key: ch.itemKey, tool: ch.tool, args: ch.args, preview: ch.preview, risk: ch.risk, status: ch.status, auto: ch.auto, dependsOn: ch.dependsOn, link: ch.link, errorCode: ch.errorCode })),
      })),
    };
  }

  async update(actor: Actor, id: string, patch: { title?: string | undefined; pinned?: boolean | undefined; archived?: boolean | undefined }) {
    await this.ownConversation(actor, id);
    await this.prisma.aiConversation.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 120) || "—" } : {}),
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
        ...(patch.archived !== undefined ? { archivedAt: patch.archived ? new Date() : null } : {}),
      },
    });
  }

  async remove(actor: Actor, id: string): Promise<void> {
    await this.ownConversation(actor, id);
    // Executed changes stay in the audit log of the records they created; the chat itself is the user's.
    await this.prisma.aiConversation.delete({ where: { id } });
  }
}

// Which top-level fields the user changed (names only: values may hold personal data).
function changedKeys(before: unknown, after: Record<string, unknown>): string[] {
  const old = (before ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(old), ...Object.keys(after)])].filter((k) => JSON.stringify(old[k]) !== JSON.stringify(after[k]));
}

// A short line for the model about a waiting card: its stored preview values (labels are i18n keys).
function previewSummary(preview: unknown): string {
  const fields = (preview as { fields?: Array<{ value?: unknown }> } | null)?.fields ?? [];
  return fields.map((f) => (typeof f.value === "string" ? f.value : "")).filter(Boolean).slice(0, 4).join(", ").slice(0, 200);
}

function outcomeView(o: ItemOutcome): ItemOutcomeView {
  switch (o.status) {
    case "executed": return { key: o.id, status: "EXECUTED", link: o.result.link ?? null };
    case "failed": return { key: o.id, status: "FAILED", errorCode: o.errorCode };
    case "rejected": return { key: o.id, status: "REJECTED" };
    case "skipped": return { key: o.id, status: "SKIPPED" };
  }
}

// AI_COMPACT_AT_TOKENS lets an operator (or a test) change when compaction starts.
function compactionFromEnv(env: NodeJS.ProcessEnv = process.env): CompactionLimits {
  const at = Number(env["AI_COMPACT_AT_TOKENS"]);
  if (!Number.isFinite(at) || at < 2000) return DEFAULT_COMPACTION;
  return { maxTokens: at, keepRecentTokens: Math.max(1000, Math.round(at / 4)) };
}

// How many of the latest user messages keep their sections' tools loaded. Each loaded section is sent
// with every model call (sales alone is ~3,400 tokens), so a section the conversation stopped using is
// dropped; the model reloads it with load_tools when needed, and a tool it calls directly still runs.
export const RECENT_SECTION_MESSAGES = 3;

// Sections to send from the first model call: the page's own, the sections used in the last few user
// messages (so a follow-up keeps its tools), the sections of cards still waiting (so they can be
// withdrawn and corrected), and purchasing when a document is attached (supplier invoice).
export function startingSections(history: readonly BaseMessage[], route: string | undefined, waitingTools: readonly string[] = []): string[] {
  const out = new Set<string>();
  const page = sectionOfRoute(route);
  if (page) out.add(page);
  for (const tool of waitingTools) {
    const s = sectionOf(tool);
    if (s !== "core") out.add(s);
  }
  let from = history.length;
  for (let seen = 0; from > 0 && seen < RECENT_SECTION_MESSAGES; ) {
    from -= 1;
    if (history[from]?.getType() === "human") seen += 1;
  }
  for (const m of history.slice(from)) {
    const calls = (m as { tool_calls?: Array<{ name: string; args?: Record<string, unknown> }> }).tool_calls ?? [];
    for (const c of calls) {
      if (c.name === LOAD_TOOLS && typeof c.args?.["section"] === "string") out.add(c.args["section"]);
      const s = sectionOf(c.name);
      if (s !== "core") out.add(s);
    }
  }
  const last = [...history].reverse().find((m) => m.getType() === "human");
  if (last && Array.isArray(last.content) && last.content.some((p) => typeof p === "object" && p !== null && "source_type" in p)) out.add("purchasing");
  return [...out];
}
