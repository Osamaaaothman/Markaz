import { randomBytes } from "node:crypto";
import {
  DiscordAdapter,
  TelegramAdapter,
  type ChannelAdapter,
  type ConnectionSecrets,
  type ProviderId,
} from "@erp/bots";
import { decryptText, encryptText } from "@erp/shared";
import { loadBotKey } from "../bots.config.js";

// Framework-free building blocks shared by the API controllers and the in-process bot runtime.

export type BotErrorCode =
  | "ENCRYPTION_KEY_MISSING"
  | "UNKNOWN_PROVIDER"
  | "CONNECTION_EXISTS"
  | "CONNECTION_NOT_FOUND"
  | "CREDENTIALS_INVALID"
  | "CONNECTION_TEST_FAILED"
  | "TRANSPORT_UNSUPPORTED"
  | "PUBLIC_URL_MISSING"
  | "DATA_SHARING_NOT_ACCEPTED"
  | "LINK_NOT_FOUND"
  | "CONNECTION_DISABLED"
  | "SUBSCRIPTION_NOT_FOUND"
  | "TARGET_NOT_FOUND"
  | "INVALID_INPUT"
  | "PLATFORM_ERROR";

export class BotError extends Error {
  constructor(
    readonly code: BotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BotError";
  }
}

export class AdapterRegistry {
  private readonly adapters: ReadonlyMap<ProviderId, ChannelAdapter>;

  constructor(adapters: ReadonlyArray<ChannelAdapter> = [new TelegramAdapter(), new DiscordAdapter()]) {
    this.adapters = new Map(adapters.map((a) => [a.provider, a]));
  }

  get(provider: string): ChannelAdapter {
    const adapter = this.adapters.get(provider as ProviderId);
    if (!adapter) throw new BotError("UNKNOWN_PROVIDER", `No adapter for provider ${provider}`);
    return adapter;
  }

  all(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }
}

// Credentials go in and out of the database only through here.
export class BotVault {
  private key(): Buffer {
    const status = loadBotKey();
    if (!status.ok) throw new BotError("ENCRYPTION_KEY_MISSING", "BOT_CREDENTIALS_ENCRYPTION_KEY is not configured");
    return status.key;
  }

  isConfigured(): boolean {
    return loadBotKey().ok;
  }

  seal(secrets: ConnectionSecrets): Uint8Array<ArrayBuffer> {
    const sealed = encryptText(JSON.stringify(secrets), this.key());
    return new Uint8Array(sealed);
  }

  open(ciphertext: Uint8Array): ConnectionSecrets {
    const parsed: unknown = JSON.parse(decryptText(ciphertext, this.key()));
    if (typeof parsed !== "object" || parsed === null) throw new BotError("CREDENTIALS_INVALID", "Stored credentials are unreadable");
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  }
}

// URL-safe random id: used for action tokens (fits Telegram's 64-byte callback_data) and link codes.
export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

// Last 4 characters only — enough for an admin to recognise which token is stored.
export function maskSecret(value: string | undefined): { readonly set: boolean; readonly last4: string | null } {
  if (!value) return { set: false, last4: null };
  return { set: true, last4: value.length > 8 ? value.slice(-4) : null };
}

export type BotLanguage = "ar" | "en";

export function asLanguage(value: string | null | undefined): BotLanguage {
  return value === "ar" ? "ar" : "en";
}
