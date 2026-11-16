import { timingSafeEqual } from "node:crypto";
import {
  AdapterError,
  type AdapterCapabilities,
  type ChannelAdapter,
  type CommandSpec,
  type ConnectionSecrets,
  type ConnectionTestResult,
  type CredentialFieldSpec,
  type HttpFetch,
  type InstallInput,
  type InstallResult,
  type OutboundTarget,
  type PollResult,
  type RawWebhookRequest,
  type WebhookParseResult,
} from "../contract/channel-adapter.js";
import type { ChatTarget, InboundEvent, InboundFileRef, SentMessageRef } from "../contract/inbound.js";
import type { BotMessage, OutboundFile } from "../contract/ui-kit.js";
import { TELEGRAM_CAPTION_LIMIT, renderTelegram } from "./telegram-renderer.js";

// Telegram Bot API adapter. A thin typed client over fetch — no SDK dependency
// (docs/BOTS-INTEGRATION-PLAN.md D-BOT-4). Limits below were written from the Bot API docs
// (core.telegram.org/bots/api) and must be rechecked when the API version moves.
const API_BASE = "https://api.telegram.org";
export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

const CAPABILITIES: AdapterCapabilities = {
  colors: false,
  maxButtonsPerRow: 3,
  maxButtonRows: 20,
  selectMenus: false,
  modals: false,
  maxTextLength: 4096,
  maxActionIdLength: 64, // callback_data: 1-64 bytes
  maxUploadBytes: 50 * 1024 * 1024, // sendDocument upload limit
  inboundFiles: true,
  transports: ["webhook", "polling"],
};

const DOWNLOAD_LIMIT = 20 * 1024 * 1024; // getFile download limit

const CREDENTIAL_FIELDS: ReadonlyArray<CredentialFieldSpec> = [
  {
    key: "botToken",
    kind: "secret",
    labelKey: "bots.telegram.fields.botToken.label",
    helpKey: "bots.telegram.fields.botToken.help",
    required: true,
    pattern: "^\\d{5,}:[A-Za-z0-9_-]{30,}$",
  },
];

interface TelegramResponse<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly description?: string;
  readonly error_code?: number;
  readonly parameters?: { readonly retry_after?: number };
}

interface TgUser {
  readonly id: number;
  readonly is_bot?: boolean;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
}

interface TgChat {
  readonly id: number;
  readonly type: string;
}

interface TgMessage {
  readonly message_id: number;
  readonly from?: TgUser;
  readonly chat: TgChat;
  readonly text?: string;
  readonly caption?: string;
  readonly reply_to_message?: { readonly message_id: number };
  readonly document?: { readonly file_id: string; readonly file_name?: string; readonly mime_type?: string; readonly file_size?: number };
  readonly photo?: ReadonlyArray<{ readonly file_id: string; readonly file_size?: number; readonly width: number }>;
}

interface TgUpdate {
  readonly update_id: number;
  readonly message?: TgMessage;
  readonly callback_query?: {
    readonly id: string;
    readonly from: TgUser;
    readonly data?: string;
    readonly message?: TgMessage;
  };
}

function token(secrets: ConnectionSecrets): string {
  const value = secrets["botToken"];
  if (!value) throw new AdapterError("UNAUTHORIZED", "Telegram bot token is missing");
  return value;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function displayName(user: TgUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || String(user.id);
}

export function parseTelegramUpdate(update: TgUpdate): InboundEvent | null {
  const eventId = `tg:${update.update_id}`;
  const callback = update.callback_query;
  if (callback) {
    if (!callback.data || !callback.message) return null;
    const chat = callback.message.chat;
    return {
      provider: "telegram",
      kind: "action",
      eventId,
      actionId: callback.data,
      ackId: callback.id,
      sender: sender(callback.from),
      chat: { chatId: String(chat.id), isPrivate: chat.type === "private" },
      message: { chatId: String(chat.id), messageId: String(callback.message.message_id) },
    };
  }
  const message = update.message;
  if (!message?.from || message.from.is_bot) return null;
  const base = {
    provider: "telegram" as const,
    eventId,
    sender: sender(message.from),
    chat: { chatId: String(message.chat.id), isPrivate: message.chat.type === "private" },
  };
  if (message.document) {
    const doc = message.document;
    return {
      ...base,
      kind: "file",
      file: {
        fileId: doc.file_id,
        fileName: doc.file_name ?? `document-${message.message_id}`,
        ...(doc.mime_type ? { contentType: doc.mime_type } : {}),
        ...(doc.file_size !== undefined ? { size: doc.file_size } : {}),
      },
      ...(message.caption ? { caption: message.caption } : {}),
    };
  }
  if (message.photo && message.photo.length > 0) {
    // Telegram sends several sizes; the widest is the original.
    const largest = [...message.photo].sort((a, b) => b.width - a.width)[0];
    if (!largest) return null;
    return {
      ...base,
      kind: "file",
      file: {
        fileId: largest.file_id,
        fileName: `photo-${message.message_id}.jpg`,
        contentType: "image/jpeg",
        ...(largest.file_size !== undefined ? { size: largest.file_size } : {}),
      },
      ...(message.caption ? { caption: message.caption } : {}),
    };
  }
  const text = message.text?.trim();
  if (!text) return null;
  if (text.startsWith("/")) {
    const [head = "", ...rest] = text.split(/\s+/);
    // "/menu@company_bot" in a group → "menu".
    const name = head.slice(1).split("@")[0]?.toLowerCase() ?? "";
    if (!name) return null;
    return { ...base, kind: "command", name, args: rest.join(" ") };
  }
  return {
    ...base,
    kind: "text",
    text,
    ...(message.reply_to_message ? { replyToMessageId: String(message.reply_to_message.message_id) } : {}),
  };
}

function sender(user: TgUser): InboundEvent["sender"] {
  return {
    id: String(user.id),
    displayName: displayName(user),
    ...(user.username ? { handle: `@${user.username}` } : {}),
    ...(user.language_code ? { locale: user.language_code } : {}),
  };
}

export class TelegramAdapter implements ChannelAdapter {
  readonly provider = "telegram" as const;
  readonly capabilities = CAPABILITIES;
  readonly credentialFields = CREDENTIAL_FIELDS;
  readonly secretKeys = ["botToken", "webhookSecret"];

  constructor(private readonly fetchFn: HttpFetch = (input, init) => fetch(input, init)) {}

  private async call<T>(secrets: ConnectionSecrets, method: string, body: Record<string, unknown> | FormData): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(`${API_BASE}/bot${token(secrets)}/${method}`, {
        method: "POST",
        ...(body instanceof FormData ? { body } : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
      });
    } catch (error) {
      throw new AdapterError("NETWORK", `Telegram ${method} failed: ${error instanceof Error ? error.message : "network error"}`);
    }
    let parsed: TelegramResponse<T>;
    try {
      parsed = (await response.json()) as TelegramResponse<T>;
    } catch {
      throw new AdapterError("NETWORK", `Telegram ${method} returned a non-JSON response (${response.status})`);
    }
    if (parsed.ok && parsed.result !== undefined) return parsed.result;
    // The description never contains the token; the URL (which does) is never put in a message.
    const description = parsed.description ?? `HTTP ${response.status}`;
    const status = parsed.error_code ?? response.status;
    if (status === 429) throw new AdapterError("RATE_LIMITED", description, (parsed.parameters?.retry_after ?? 1) * 1000);
    if (status === 401 || status === 404) throw new AdapterError("UNAUTHORIZED", description);
    if (status === 403) throw new AdapterError("BLOCKED", description);
    if (status === 413) throw new AdapterError("TOO_LARGE", description);
    if (status >= 500) throw new AdapterError("NETWORK", description);
    throw new AdapterError("BAD_REQUEST", description);
  }

  async testConnection(secrets: ConnectionSecrets): Promise<ConnectionTestResult> {
    try {
      const me = await this.call<TgUser>(secrets, "getMe", {});
      return { ok: true, identity: { id: String(me.id), username: me.username ? `@${me.username}` : String(me.id), displayName: displayName(me) } };
    } catch (error) {
      if (error instanceof AdapterError) return { ok: false, code: error.code, detail: error.message };
      throw error;
    }
  }

  async install(input: InstallInput): Promise<InstallResult> {
    if (input.transport === "webhook") {
      if (!input.webhookUrl) throw new AdapterError("BAD_REQUEST", "A public webhook URL is required for webhook mode");
      const secret = input.secrets["webhookSecret"];
      if (!secret) throw new AdapterError("BAD_REQUEST", "Webhook secret is missing");
      await this.call(input.secrets, "setWebhook", {
        url: input.webhookUrl,
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
      });
    } else {
      // getUpdates refuses to work while a webhook is set.
      await this.call(input.secrets, "deleteWebhook", { drop_pending_updates: false });
    }
    const commands = (lang: "en" | "ar") =>
      input.commands.map((c: CommandSpec) => ({ command: c.name, description: c.description[lang].slice(0, 256) }));
    await this.call(input.secrets, "setMyCommands", { commands: commands("en") });
    await this.call(input.secrets, "setMyCommands", { commands: commands("ar"), language_code: "ar" });
    await this.call(input.secrets, "setChatMenuButton", { menu_button: { type: "commands" } });
    return { webhookConfigured: input.transport === "webhook", commandsRegistered: input.commands.length };
  }

  async uninstall(secrets: ConnectionSecrets): Promise<void> {
    await this.call(secrets, "deleteWebhook", { drop_pending_updates: true });
    await this.call(secrets, "deleteMyCommands", {});
  }

  parseWebhook(request: RawWebhookRequest, secrets: ConnectionSecrets): WebhookParseResult {
    const expected = secrets["webhookSecret"];
    const received = request.headers[TELEGRAM_SECRET_HEADER];
    if (!expected || !received || !safeEqual(received, expected)) return { status: "rejected", reason: "bad_secret" };
    let update: TgUpdate;
    try {
      update = JSON.parse(request.rawBody.toString("utf8")) as TgUpdate;
    } catch {
      return { status: "rejected", reason: "malformed" };
    }
    if (typeof update.update_id !== "number") return { status: "rejected", reason: "malformed" };
    const event = parseTelegramUpdate(update);
    return event ? { status: "event", event } : { status: "ignored" };
  }

  immediateResponse(): unknown {
    // Telegram only needs a 200; answers go out through the API afterwards.
    return {};
  }

  async poll(secrets: ConnectionSecrets, offset: string | null, timeoutSeconds: number): Promise<PollResult> {
    const updates = await this.call<TgUpdate[]>(secrets, "getUpdates", {
      timeout: timeoutSeconds,
      allowed_updates: ["message", "callback_query"],
      ...(offset ? { offset: Number(offset) } : {}),
    });
    const events = updates.map(parseTelegramUpdate).filter((e): e is InboundEvent => e !== null);
    const last = updates.at(-1);
    return { events, nextOffset: last ? String(last.update_id + 1) : offset };
  }

  async acknowledge(event: InboundEvent, secrets: ConnectionSecrets, notice?: string): Promise<void> {
    if (event.kind !== "action" || !event.ackId) return;
    await this.call(secrets, "answerCallbackQuery", { callback_query_id: event.ackId, ...(notice ? { text: notice.slice(0, 200) } : {}) });
  }

  async showActivity(target: ChatTarget, kind: "typing" | "uploading", secrets: ConnectionSecrets): Promise<void> {
    await this.call(secrets, "sendChatAction", { chat_id: target.chatId, action: kind === "typing" ? "typing" : "upload_document" });
  }

  async reply(event: InboundEvent, message: BotMessage, secrets: ConnectionSecrets, mode: "replace" | "new"): Promise<SentMessageRef> {
    if (mode === "replace" && event.message) {
      try {
        await this.edit(event.message, message, secrets);
        return event.message;
      } catch (error) {
        // Old messages (or ones carrying a file) cannot be edited — fall back to a new message.
        if (!(error instanceof AdapterError) || error.code !== "BAD_REQUEST") throw error;
      }
    }
    return this.send(event.chat, message, secrets);
  }

  replyFile(event: InboundEvent, file: OutboundFile, caption: BotMessage | null, secrets: ConnectionSecrets): Promise<SentMessageRef> {
    return this.sendFile(event.chat, file, caption, secrets);
  }

  async send(target: OutboundTarget, message: BotMessage, secrets: ConnectionSecrets): Promise<SentMessageRef> {
    const rendered = renderTelegram(message);
    const sent = await this.call<TgMessage>(secrets, "sendMessage", {
      chat_id: target.chatId,
      text: rendered.text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(rendered.reply_markup ? { reply_markup: rendered.reply_markup } : {}),
    });
    return { chatId: target.chatId, messageId: String(sent.message_id) };
  }

  async edit(ref: SentMessageRef, message: BotMessage, secrets: ConnectionSecrets): Promise<void> {
    const rendered = renderTelegram(message);
    try {
      await this.call(secrets, "editMessageText", {
        chat_id: ref.chatId,
        message_id: Number(ref.messageId),
        text: rendered.text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: rendered.reply_markup ?? { inline_keyboard: [] },
      });
    } catch (error) {
      // Tapping the same page twice: nothing to change is not a failure.
      if (error instanceof AdapterError && error.code === "BAD_REQUEST" && /not modified/i.test(error.message)) return;
      throw error;
    }
  }

  async sendFile(target: OutboundTarget, file: OutboundFile, caption: BotMessage | null, secrets: ConnectionSecrets): Promise<SentMessageRef> {
    if (file.bytes.byteLength > CAPABILITIES.maxUploadBytes) throw new AdapterError("TOO_LARGE", "File is larger than Telegram accepts from bots");
    const form = new FormData();
    form.append("chat_id", target.chatId);
    form.append("document", new Blob([new Uint8Array(file.bytes)], { type: file.contentType }), file.fileName);
    if (caption) {
      const rendered = renderTelegram(caption, TELEGRAM_CAPTION_LIMIT);
      form.append("caption", rendered.text);
      form.append("parse_mode", "HTML");
      if (rendered.reply_markup) form.append("reply_markup", JSON.stringify(rendered.reply_markup));
    }
    const sent = await this.call<TgMessage>(secrets, "sendDocument", form);
    return { chatId: target.chatId, messageId: String(sent.message_id) };
  }

  async sendPrompt(target: OutboundTarget, text: string, secrets: ConnectionSecrets): Promise<SentMessageRef> {
    const sent = await this.call<TgMessage>(secrets, "sendMessage", {
      chat_id: target.chatId,
      text: text.slice(0, 4096),
      reply_markup: { force_reply: true, selective: true },
    });
    return { chatId: target.chatId, messageId: String(sent.message_id) };
  }

  openDirectChat(userId: string): Promise<ChatTarget> {
    // In Telegram a user's private chat with the bot has the same id as the user.
    return Promise.resolve({ chatId: userId, isPrivate: true });
  }

  async downloadFile(ref: InboundFileRef, secrets: ConnectionSecrets, maxBytes: number): Promise<Uint8Array> {
    const limit = Math.min(maxBytes, DOWNLOAD_LIMIT);
    if (ref.size !== undefined && ref.size > limit) throw new AdapterError("TOO_LARGE", "File is too large to download");
    const info = await this.call<{ file_path?: string; file_size?: number }>(secrets, "getFile", { file_id: ref.fileId });
    if (!info.file_path) throw new AdapterError("NOT_FOUND", "Telegram did not return a file path");
    let response: Response;
    try {
      response = await this.fetchFn(`${API_BASE}/file/bot${token(secrets)}/${info.file_path}`);
    } catch {
      throw new AdapterError("NETWORK", "Telegram file download failed");
    }
    if (!response.ok) throw new AdapterError(response.status === 404 ? "NOT_FOUND" : "NETWORK", `File download failed (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new AdapterError("TOO_LARGE", "File is too large");
    return bytes;
  }
}
