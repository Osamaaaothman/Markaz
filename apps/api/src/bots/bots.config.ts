import { KeyEncryptionError, loadEncryptionKey } from "@erp/shared";

// Environment for the chat bots (docs/BOTS-INTEGRATION-PLAN.md §6.1). Everything is optional: a
// deployment without bots boots normally and the settings page explains what is missing.
export const BOT_KEY_ENV = "BOT_CREDENTIALS_ENCRYPTION_KEY";

export interface BotsConfig {
  // Public HTTPS base the chat platforms can reach, e.g. "https://erp.example.com/api".
  // Null: webhook mode is unavailable (Telegram polling still works).
  readonly publicApiBaseUrl: string | null;
  // Where "Open in ERP" buttons point, e.g. "https://erp.example.com".
  readonly webAppUrl: string | null;
  // "off" stops the in-process bot workers (e.g. for a second API replica that should only
  // serve HTTP). Webhooks are still accepted and queued.
  readonly runtimeEnabled: boolean;
}

function cleanUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return trimmed.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function parseBotsConfig(env: NodeJS.ProcessEnv): BotsConfig {
  return {
    publicApiBaseUrl: cleanUrl(env["BOTS_PUBLIC_API_URL"]),
    webAppUrl: cleanUrl(env["BOTS_WEB_APP_URL"]),
    runtimeEnabled: env["BOTS_RUNTIME"] !== "off",
  };
}

export type BotKeyStatus = { readonly ok: true; readonly key: Buffer } | { readonly ok: false; readonly code: "KEY_NOT_CONFIGURED" | "KEY_WRONG_LENGTH" };

// Re-read on every call (cheap) so the key is never cached in a long-lived object that could be
// dumped by a debugger or a careless log line.
export function loadBotKey(): BotKeyStatus {
  try {
    return { ok: true, key: loadEncryptionKey(BOT_KEY_ENV) };
  } catch (error) {
    if (error instanceof KeyEncryptionError && (error.code === "KEY_NOT_CONFIGURED" || error.code === "KEY_WRONG_LENGTH")) {
      return { ok: false, code: error.code };
    }
    throw error;
  }
}
