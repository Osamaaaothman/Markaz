import type { ChatTarget, InboundEvent, InboundFileRef, ProviderId, SentMessageRef } from "./inbound.js";
import type { BotMessage, FormSpec, OutboundFile } from "./ui-kit.js";

// The one contract every chat platform implements (docs/BOTS-INTEGRATION-PLAN.md §3). Adding a
// platform means writing one of these — no change to the Bot Hub's features or to the settings UI.

export interface AdapterCapabilities {
  // Real accent colours (Discord). Without them the renderer marks tone with an emoji.
  readonly colors: boolean;
  readonly maxButtonsPerRow: number;
  readonly maxButtonRows: number;
  readonly selectMenus: boolean;
  // Native pop-up forms (Discord modals). Without them the Hub asks with a reply prompt.
  readonly modals: boolean;
  readonly maxTextLength: number;
  // Longest action id the platform carries back (Telegram callback_data: 64 bytes).
  readonly maxActionIdLength: number;
  readonly maxUploadBytes: number;
  readonly inboundFiles: boolean;
  readonly transports: ReadonlyArray<Transport>;
}

export type Transport = "webhook" | "polling";

export type CredentialFieldKind = "secret" | "text" | "select";

// Drives the settings form. Labels and help are translation keys of the web app (namespace
// "bots"); the server never sends display text for these.
export interface CredentialFieldSpec {
  readonly key: string;
  readonly kind: CredentialFieldKind;
  readonly labelKey: string;
  readonly helpKey: string;
  readonly required: boolean;
  readonly pattern?: string;
  readonly options?: ReadonlyArray<{ readonly value: string; readonly labelKey: string }>;
}

// Decrypted credentials plus Hub-generated internals (e.g. the Telegram webhook secret). Lives
// only in memory for the duration of one call; never logged, never returned by the API.
export type ConnectionSecrets = Readonly<Record<string, string>>;

export interface BotIdentity {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
}

export type ConnectionTestResult =
  | { readonly ok: true; readonly identity: BotIdentity }
  | { readonly ok: false; readonly code: AdapterErrorCode; readonly detail?: string };

export interface CommandSpec {
  readonly name: string;
  readonly description: { readonly en: string; readonly ar: string };
  readonly option?: {
    readonly name: string;
    readonly kind: "text" | "file";
    readonly description: { readonly en: string; readonly ar: string };
    readonly required: boolean;
  };
}

export interface InstallInput {
  readonly secrets: ConnectionSecrets;
  readonly transport: Transport;
  readonly webhookUrl: string | null;
  readonly commands: ReadonlyArray<CommandSpec>;
}

export interface InstallResult {
  // Non-secret facts the settings page shows, e.g. whether the endpoint URL was set automatically.
  readonly webhookConfigured: boolean;
  readonly commandsRegistered: number;
  readonly manualStepKey?: string;
  readonly inviteUrl?: string;
}

export interface RawWebhookRequest {
  readonly headers: Readonly<Record<string, string | undefined>>;
  // Exact bytes as received — Discord's signature is over the raw body.
  readonly rawBody: Buffer;
}

export type WebhookParseResult =
  | { readonly status: "rejected"; readonly reason: "bad_signature" | "bad_secret" | "malformed" }
  // Platform handshake (Discord PING) answered directly, no event.
  | { readonly status: "handshake"; readonly response: unknown }
  // An update we do not handle (e.g. a Telegram "edited_message").
  | { readonly status: "ignored" }
  | { readonly status: "event"; readonly event: InboundEvent };

export interface PollResult {
  readonly events: ReadonlyArray<InboundEvent>;
  readonly nextOffset: string | null;
}

export interface ChannelAdapter {
  readonly provider: ProviderId;
  readonly capabilities: AdapterCapabilities;
  readonly credentialFields: ReadonlyArray<CredentialFieldSpec>;
  // Credential keys whose values are secrets (redacted, never returned).
  readonly secretKeys: ReadonlyArray<string>;

  testConnection(secrets: ConnectionSecrets): Promise<ConnectionTestResult>;
  install(input: InstallInput): Promise<InstallResult>;
  uninstall(secrets: ConnectionSecrets): Promise<void>;

  // Pure: verifies the request came from the platform and normalizes it. No network I/O.
  parseWebhook(request: RawWebhookRequest, secrets: ConnectionSecrets): WebhookParseResult;
  // The HTTP body to answer the webhook with, right now (Discord must hear back within 3 s).
  // `form` is set when the tapped action opens a form and the platform supports modals.
  immediateResponse(event: InboundEvent, form?: { readonly actionId: string; readonly spec: FormSpec }): unknown;
  // Long polling for deployments with no public HTTPS address (Telegram). Optional.
  poll?(secrets: ConnectionSecrets, offset: string | null, timeoutSeconds: number): Promise<PollResult>;

  // Tells the platform the tap was received (Telegram answerCallbackQuery). `notice` is a short toast.
  acknowledge(event: InboundEvent, secrets: ConnectionSecrets, notice?: string): Promise<void>;
  showActivity(target: ChatTarget, kind: "typing" | "uploading", secrets: ConnectionSecrets): Promise<void>;

  // Answers an inbound event. "replace" updates the message the user acted on (in-place
  // navigation) or, for a command, the platform's pending placeholder; "new" posts a new message.
  reply(event: InboundEvent, message: BotMessage, secrets: ConnectionSecrets, mode: "replace" | "new"): Promise<SentMessageRef>;
  replyFile(event: InboundEvent, file: OutboundFile, caption: BotMessage | null, secrets: ConnectionSecrets): Promise<SentMessageRef>;

  send(target: OutboundTarget, message: BotMessage, secrets: ConnectionSecrets): Promise<SentMessageRef>;
  edit(ref: SentMessageRef, message: BotMessage, secrets: ConnectionSecrets): Promise<void>;
  sendFile(target: OutboundTarget, file: OutboundFile, caption: BotMessage | null, secrets: ConnectionSecrets): Promise<SentMessageRef>;
  // Asks for free text in reply (used for forms when `capabilities.modals` is false).
  sendPrompt(target: OutboundTarget, text: string, secrets: ConnectionSecrets): Promise<SentMessageRef>;
  // Opens a direct-message channel with a user (Discord needs one before it can DM). Telegram:
  // the private chat id equals the user id.
  openDirectChat(userId: string, secrets: ConnectionSecrets): Promise<ChatTarget>;
  downloadFile(ref: InboundFileRef, secrets: ConnectionSecrets, maxBytes: number): Promise<Uint8Array>;
}

export interface OutboundTarget extends ChatTarget {
  // Discord: answer through the interaction instead of a plain channel message.
  readonly interactionToken?: string;
}

export type AdapterErrorCode =
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "BLOCKED"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "TOO_LARGE"
  | "NETWORK"
  | "UNSUPPORTED";

export class AdapterError extends Error {
  constructor(
    readonly code: AdapterErrorCode,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AdapterError";
  }

  // A retry can succeed (temporary). Unauthorized/blocked/bad requests never will.
  get retryable(): boolean {
    return this.code === "RATE_LIMITED" || this.code === "NETWORK";
  }
}

export type HttpFetch = (input: string, init?: RequestInit) => Promise<Response>;
