import { createPublicKey, verify } from "node:crypto";
import {
  AdapterError,
  type AdapterCapabilities,
  type ChannelAdapter,
  type ConnectionSecrets,
  type ConnectionTestResult,
  type CredentialFieldSpec,
  type HttpFetch,
  type InstallInput,
  type InstallResult,
  type OutboundTarget,
  type RawWebhookRequest,
  type WebhookParseResult,
} from "../contract/channel-adapter.js";
import type { ChatTarget, InboundEvent, InboundFileRef, SentMessageRef } from "../contract/inbound.js";
import type { BotMessage, FormSpec, OutboundFile, PromptSpec } from "../contract/ui-kit.js";
import { renderDiscord, renderDiscordModal } from "./discord-renderer.js";

// Discord adapter over HTTP interactions + REST — no websocket gateway and no SDK
// (docs/BOTS-INTEGRATION-PLAN.md D-BOT-4 option A). Values from discord.com/developers/docs;
// recheck the upload limit and API version when upgrading.
const API_BASE = "https://discord.com/api/v10";
const SIGNATURE_HEADER = "x-signature-ed25519";
const TIMESTAMP_HEADER = "x-signature-timestamp";
// SubjectPublicKeyInfo DER prefix for a raw 32-byte Ed25519 key (RFC 8410).
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const EPHEMERAL = 1 << 6;
// View channel, send messages, embed links, attach files, read message history.
const INVITE_PERMISSIONS = String((1 << 10) | (1 << 11) | (1 << 14) | (1 << 15) | (1 << 16));
const CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

const CAPABILITIES: AdapterCapabilities = {
  colors: true,
  maxButtonsPerRow: 5,
  maxButtonRows: 5,
  selectMenus: true,
  modals: true,
  maxTextLength: 4096,
  maxActionIdLength: 100, // custom_id
  maxUploadBytes: 10 * 1024 * 1024, // REVIEW: bot upload limit (10 MiB at time of writing) — verify.
  inboundFiles: true,
  transports: ["webhook"],
};

const CREDENTIAL_FIELDS: ReadonlyArray<CredentialFieldSpec> = [
  { key: "applicationId", kind: "text", labelKey: "bots.discord.fields.applicationId.label", helpKey: "bots.discord.fields.applicationId.help", required: true, pattern: "^\\d{15,25}$" },
  { key: "publicKey", kind: "text", labelKey: "bots.discord.fields.publicKey.label", helpKey: "bots.discord.fields.publicKey.help", required: true, pattern: "^[0-9a-fA-F]{64}$" },
  { key: "botToken", kind: "secret", labelKey: "bots.discord.fields.botToken.label", helpKey: "bots.discord.fields.botToken.help", required: true, pattern: "^[A-Za-z0-9._-]{50,}$" },
  { key: "guildId", kind: "text", labelKey: "bots.discord.fields.guildId.label", helpKey: "bots.discord.fields.guildId.help", required: false, pattern: "^\\d{15,25}$" },
];

interface DcUser {
  readonly id: string;
  readonly username: string;
  readonly global_name?: string | null;
}

interface DcAttachment {
  readonly id: string;
  readonly filename: string;
  readonly content_type?: string;
  readonly size?: number;
  readonly url: string;
}

interface DcInteraction {
  readonly id: string;
  readonly type: number;
  readonly token: string;
  readonly channel_id?: string;
  readonly guild_id?: string;
  readonly locale?: string;
  readonly user?: DcUser;
  readonly member?: { readonly user?: DcUser };
  readonly message?: { readonly id: string };
  readonly data?: {
    readonly name?: string;
    readonly custom_id?: string;
    readonly component_type?: number;
    readonly values?: ReadonlyArray<string>;
    readonly options?: ReadonlyArray<{ readonly name: string; readonly type: number; readonly value?: string }>;
    readonly resolved?: { readonly attachments?: Readonly<Record<string, DcAttachment>> };
    readonly components?: ReadonlyArray<{ readonly components?: ReadonlyArray<{ readonly custom_id: string; readonly value?: string }> }>;
  };
}

function secret(secrets: ConnectionSecrets, key: string): string {
  const value = secrets[key];
  if (!value) throw new AdapterError("UNAUTHORIZED", `Discord ${key} is missing`);
  return value;
}

export function verifyDiscordSignature(publicKeyHex: string, signatureHex: string, timestamp: string, rawBody: Buffer): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex) || !/^[0-9a-fA-F]{128}$/.test(signatureHex)) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

export function parseDiscordInteraction(interaction: DcInteraction): InboundEvent | null {
  const user = interaction.member?.user ?? interaction.user;
  if (!user || !interaction.channel_id) return null;
  const base = {
    provider: "discord" as const,
    eventId: `dc:${interaction.id}`,
    interactionToken: interaction.token,
    sender: {
      id: user.id,
      handle: `@${user.username}`,
      displayName: user.global_name ?? user.username,
      ...(interaction.locale ? { locale: interaction.locale } : {}),
    },
    chat: { chatId: interaction.channel_id, isPrivate: !interaction.guild_id },
    ...(interaction.message
      ? { message: { chatId: interaction.channel_id, messageId: "@original", interactionToken: interaction.token } }
      : {}),
  };
  const data = interaction.data;
  if (interaction.type === 2 && data?.name) {
    const option = data.options?.[0];
    if (option?.type === 11 && option.value) {
      const attachment = data.resolved?.attachments?.[option.value];
      if (!attachment) return null;
      return {
        ...base,
        kind: "file",
        file: {
          fileId: attachment.id,
          fileName: attachment.filename,
          url: attachment.url,
          ...(attachment.content_type ? { contentType: attachment.content_type } : {}),
          ...(attachment.size !== undefined ? { size: attachment.size } : {}),
        },
      };
    }
    return { ...base, kind: "command", name: data.name.toLowerCase(), args: option?.value ?? "" };
  }
  if (interaction.type === 3 && data?.custom_id) {
    const actionId = data.component_type === 3 ? data.values?.[0] : data.custom_id;
    if (!actionId) return null;
    return { ...base, kind: "action", actionId };
  }
  if (interaction.type === 5 && data?.custom_id) {
    const fields: Record<string, string> = {};
    for (const row of data.components ?? []) for (const input of row.components ?? []) fields[input.custom_id] = input.value ?? "";
    return { ...base, kind: "form", actionId: data.custom_id, fields };
  }
  return null;
}

export class DiscordAdapter implements ChannelAdapter {
  readonly provider = "discord" as const;
  readonly capabilities = CAPABILITIES;
  readonly credentialFields = CREDENTIAL_FIELDS;
  readonly secretKeys = ["botToken"];

  constructor(
    private readonly fetchFn: HttpFetch = (input, init) => fetch(input, init),
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  private async request<T>(secrets: ConnectionSecrets | null, method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (secrets) headers["authorization"] = `Bot ${secret(secrets, "botToken")}`;
    let init: RequestInit = { method, headers };
    if (body instanceof FormData) init = { ...init, body };
    else if (body !== undefined) init = { ...init, body: JSON.stringify(body), headers: { ...headers, "content-type": "application/json" } };
    let response: Response;
    try {
      response = await this.fetchFn(`${API_BASE}${path}`, init);
    } catch (error) {
      throw new AdapterError("NETWORK", `Discord ${method} failed: ${error instanceof Error ? error.message : "network error"}`);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (response.ok) return parsed as T;
    const error = (parsed ?? {}) as { message?: string; code?: number; retry_after?: number };
    const message = `Discord ${response.status}: ${error.message ?? "request failed"}`;
    if (response.status === 429) throw new AdapterError("RATE_LIMITED", message, Math.ceil((error.retry_after ?? 1) * 1000));
    if (response.status === 401) throw new AdapterError("UNAUTHORIZED", message);
    if (response.status === 403) throw new AdapterError(error.code === 50007 ? "BLOCKED" : "UNAUTHORIZED", message);
    if (response.status === 404) throw new AdapterError("NOT_FOUND", message);
    if (response.status === 413) throw new AdapterError("TOO_LARGE", message);
    if (response.status >= 500) throw new AdapterError("NETWORK", message);
    throw new AdapterError("BAD_REQUEST", message);
  }

  async testConnection(secrets: ConnectionSecrets): Promise<ConnectionTestResult> {
    try {
      const app = await this.request<{ id: string; name: string; verify_key?: string }>(secrets, "GET", "/applications/@me");
      if (app.id !== secrets["applicationId"]) return { ok: false, code: "BAD_REQUEST", detail: "The bot token belongs to a different application" };
      if (app.verify_key && secrets["publicKey"] && app.verify_key.toLowerCase() !== secrets["publicKey"].toLowerCase()) {
        return { ok: false, code: "BAD_REQUEST", detail: "The public key does not match the application" };
      }
      const me = await this.request<DcUser>(secrets, "GET", "/users/@me");
      return { ok: true, identity: { id: me.id, username: `@${me.username}`, displayName: me.global_name ?? app.name } };
    } catch (error) {
      if (error instanceof AdapterError) return { ok: false, code: error.code, detail: error.message };
      throw error;
    }
  }

  private commandsPath(secrets: ConnectionSecrets): string {
    const app = secret(secrets, "applicationId");
    const guild = secrets["guildId"];
    return guild ? `/applications/${app}/guilds/${guild}/commands` : `/applications/${app}/commands`;
  }

  async install(input: InstallInput): Promise<InstallResult> {
    // Discord has no Arabic command locale, so names and descriptions are English; replies follow
    // the linked user's ERP language.
    const commands = input.commands.map((c) => ({
      name: c.name,
      type: 1,
      description: c.description.en.slice(0, 100),
      ...(c.option
        ? { options: [{ type: c.option.kind === "file" ? 11 : 3, name: c.option.name, description: c.option.description.en.slice(0, 100), required: c.option.required }] }
        : {}),
    }));
    await this.request(input.secrets, "PUT", this.commandsPath(input.secrets), commands);
    let webhookConfigured = false;
    if (input.webhookUrl) {
      try {
        // Discord pings the URL with a signed request before accepting it, so this only succeeds
        // once the endpoint is publicly reachable.
        await this.request(input.secrets, "PATCH", "/applications/@me", { interactions_endpoint_url: input.webhookUrl });
        webhookConfigured = true;
      } catch (error) {
        if (!(error instanceof AdapterError) || error.code !== "BAD_REQUEST") throw error;
      }
    }
    const appId = secret(input.secrets, "applicationId");
    return {
      webhookConfigured,
      commandsRegistered: commands.length,
      inviteUrl: `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`,
      ...(webhookConfigured ? {} : { manualStepKey: "bots.discord.manualEndpoint" }),
    };
  }

  async uninstall(secrets: ConnectionSecrets): Promise<void> {
    await this.request(secrets, "PUT", this.commandsPath(secrets), []);
  }

  parseWebhook(request: RawWebhookRequest, secrets: ConnectionSecrets): WebhookParseResult {
    const signature = request.headers[SIGNATURE_HEADER];
    const timestamp = request.headers[TIMESTAMP_HEADER];
    const publicKey = secrets["publicKey"];
    if (!signature || !timestamp || !publicKey) return { status: "rejected", reason: "bad_signature" };
    const sent = Number(timestamp);
    if (!Number.isFinite(sent) || Math.abs(this.nowSeconds() - sent) > MAX_CLOCK_SKEW_SECONDS) return { status: "rejected", reason: "bad_signature" };
    if (!verifyDiscordSignature(publicKey, signature, timestamp, request.rawBody)) return { status: "rejected", reason: "bad_signature" };
    let interaction: DcInteraction;
    try {
      interaction = JSON.parse(request.rawBody.toString("utf8")) as DcInteraction;
    } catch {
      return { status: "rejected", reason: "malformed" };
    }
    if (interaction.type === 1) return { status: "handshake", response: { type: 1 } };
    const event = parseDiscordInteraction(interaction);
    return event ? { status: "event", event } : { status: "ignored" };
  }

  immediateResponse(event: InboundEvent, form?: { readonly actionId: string; readonly spec: FormSpec }): unknown {
    if (form) return renderDiscordModal(form.actionId, form.spec);
    // Inside a server channel answers are private to the user who asked (ephemeral).
    const flags = event.chat.isPrivate ? 0 : EPHEMERAL;
    if (event.kind === "action" || event.kind === "form") return { type: 6 }; // deferred update of the clicked message
    return { type: 5, data: { flags } }; // deferred reply ("thinking…")
  }

  async acknowledge(): Promise<void> {
    // Already acknowledged by immediateResponse.
  }

  async showActivity(target: ChatTarget, _kind: "typing" | "uploading", secrets: ConnectionSecrets): Promise<void> {
    await this.request(secrets, "POST", `/channels/${target.chatId}/typing`);
  }

  async reply(event: InboundEvent, message: BotMessage, secrets: ConnectionSecrets, mode: "replace" | "new"): Promise<SentMessageRef> {
    if (!event.interactionToken) return this.send(event.chat, message, secrets);
    if (mode === "replace") {
      const ref = { chatId: event.chat.chatId, messageId: "@original", interactionToken: event.interactionToken };
      await this.edit(ref, message, secrets);
      return ref;
    }
    return this.send({ ...event.chat, interactionToken: event.interactionToken }, message, secrets);
  }

  replyFile(event: InboundEvent, file: OutboundFile, caption: BotMessage | null, secrets: ConnectionSecrets): Promise<SentMessageRef> {
    return this.sendFile({ ...event.chat, ...(event.interactionToken ? { interactionToken: event.interactionToken } : {}) }, file, caption, secrets);
  }

  async send(target: OutboundTarget, message: BotMessage, secrets: ConnectionSecrets): Promise<SentMessageRef> {
    const payload = renderDiscord(message);
    if (target.interactionToken) {
      const sent = await this.request<{ id: string }>(null, "POST", `/webhooks/${secret(secrets, "applicationId")}/${target.interactionToken}?wait=true`, {
        ...payload,
        ...(target.isPrivate ? {} : { flags: EPHEMERAL }),
      });
      return { chatId: target.chatId, messageId: sent.id, interactionToken: target.interactionToken };
    }
    const sent = await this.request<{ id: string }>(secrets, "POST", `/channels/${target.chatId}/messages`, payload);
    return { chatId: target.chatId, messageId: sent.id };
  }

  async edit(ref: SentMessageRef, message: BotMessage, secrets: ConnectionSecrets): Promise<void> {
    const payload = renderDiscord(message);
    if (ref.interactionToken) {
      await this.request(null, "PATCH", `/webhooks/${secret(secrets, "applicationId")}/${ref.interactionToken}/messages/${ref.messageId}`, payload);
      return;
    }
    await this.request(secrets, "PATCH", `/channels/${ref.chatId}/messages/${ref.messageId}`, payload);
  }

  async sendFile(target: OutboundTarget, file: OutboundFile, caption: BotMessage | null, secrets: ConnectionSecrets): Promise<SentMessageRef> {
    if (file.bytes.byteLength > CAPABILITIES.maxUploadBytes) throw new AdapterError("TOO_LARGE", "File is larger than Discord accepts from bots");
    const payload = {
      ...(caption ? renderDiscord(caption) : { content: "" }),
      attachments: [{ id: 0, filename: file.fileName }],
      ...(target.interactionToken && !target.isPrivate ? { flags: EPHEMERAL } : {}),
    };
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    form.append("files[0]", new Blob([new Uint8Array(file.bytes)], { type: file.contentType }), file.fileName);
    if (target.interactionToken) {
      const sent = await this.request<{ id: string }>(null, "POST", `/webhooks/${secret(secrets, "applicationId")}/${target.interactionToken}?wait=true`, form);
      return { chatId: target.chatId, messageId: sent.id, interactionToken: target.interactionToken };
    }
    const sent = await this.request<{ id: string }>(secrets, "POST", `/channels/${target.chatId}/messages`, form);
    return { chatId: target.chatId, messageId: sent.id };
  }

  sendPrompt(target: OutboundTarget, prompt: PromptSpec, secrets: ConnectionSecrets): Promise<SentMessageRef> {
    return this.send(target, { direction: "ltr", blocks: [{ type: "header", tone: "info", icon: "search", title: prompt.title, subtitle: prompt.hint }] }, secrets);
  }

  async openDirectChat(userId: string, secrets: ConnectionSecrets): Promise<ChatTarget> {
    const channel = await this.request<{ id: string }>(secrets, "POST", "/users/@me/channels", { recipient_id: userId });
    return { chatId: channel.id, isPrivate: true };
  }

  async downloadFile(ref: InboundFileRef, _secrets: ConnectionSecrets, maxBytes: number): Promise<Uint8Array> {
    if (!ref.url) throw new AdapterError("NOT_FOUND", "Attachment has no URL");
    let host: string;
    try {
      host = new URL(ref.url).hostname;
    } catch {
      throw new AdapterError("BAD_REQUEST", "Attachment URL is invalid");
    }
    // Only Discord's own CDN — never fetch an arbitrary URL from a request body.
    if (!CDN_HOSTS.has(host)) throw new AdapterError("BAD_REQUEST", "Attachment is not on Discord's CDN");
    if (ref.size !== undefined && ref.size > maxBytes) throw new AdapterError("TOO_LARGE", "File is too large");
    let response: Response;
    try {
      response = await this.fetchFn(ref.url);
    } catch {
      throw new AdapterError("NETWORK", "Attachment download failed");
    }
    if (!response.ok) throw new AdapterError("NETWORK", `Attachment download failed (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new AdapterError("TOO_LARGE", "File is too large");
    return bytes;
  }
}
