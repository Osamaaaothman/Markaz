import { createChatModel, OPENAI_COMPATIBLE_PRESETS, type ProviderConfig, type ProviderKind } from "@erp/ai";
import type { IAuditLogger } from "@erp/core";
import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { loadKey, openText, sealText } from "../bots/application/bot-secret-box.js";

// The env var holding the 32-byte AES key that seals provider API keys at rest.
export const AI_KEY_ENV = "AI_CREDENTIALS_ENCRYPTION_KEY";

export const PROVIDERS: readonly ProviderKind[] = ["google", "anthropic", "openai", "openai-compatible", "ollama"];

export class AiSettingsError extends Error {
  constructor(readonly code: "INVALID_PROVIDER" | "MODEL_REQUIRED" | "BASE_URL_REQUIRED" | "API_KEY_REQUIRED" | "VERSION_CONFLICT" | "NOT_CONFIGURED" | "DISABLED" | "ENCRYPTION_KEY_MISSING") {
    super(code);
    this.name = "AiSettingsError";
  }
}

// What the API returns. Never the key itself — only whether one is stored.
export interface AiSettingsView {
  readonly source: "database" | "environment" | "none";
  readonly provider: ProviderKind | null;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly hasApiKey: boolean;
  readonly enabled: boolean;
  readonly autoModeEnabled: boolean;
  readonly monthlyTokenLimit: number | null;
  readonly version: number;
  readonly presets: Readonly<Record<string, string>>;
}

export interface UpdateAiSettingsInput {
  readonly provider: ProviderKind;
  readonly model: string;
  readonly baseUrl?: string | null | undefined;
  // undefined = keep the stored key; null or "" = remove it; a string = replace it.
  readonly apiKey?: string | null | undefined;
  readonly enabled: boolean;
  readonly autoModeEnabled: boolean;
  readonly monthlyTokenLimit?: number | null | undefined;
  readonly version: number;
}

export interface ResolvedAiConfig {
  readonly provider: ProviderConfig;
  readonly autoModeEnabled: boolean;
  readonly monthlyTokenLimit: number | null;
}

// A deployment owner can also configure the provider in the server .env (AI_PROVIDER, AI_MODEL,
// AI_BASE_URL and the matching key). The database row, set from the settings page, wins when present.
function fromEnvironment(env: NodeJS.ProcessEnv): ProviderConfig | null {
  const provider = env["AI_PROVIDER"] as ProviderKind | undefined;
  const model = env["AI_MODEL"];
  if (!provider || !model || !PROVIDERS.includes(provider)) return null;
  const keyVar: Record<ProviderKind, string> = { google: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", "openai-compatible": "AI_API_KEY", ollama: "AI_API_KEY" };
  return { provider, model, apiKey: env[keyVar[provider]] ?? env["AI_API_KEY"], baseUrl: env["AI_BASE_URL"] };
}

export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async view(companyId: string): Promise<AiSettingsView> {
    const row = await this.prisma.aiProviderConfig.findUnique({ where: { companyId } });
    if (row) {
      return {
        source: "database",
        provider: row.provider as ProviderKind,
        model: row.model,
        baseUrl: row.baseUrl,
        hasApiKey: row.apiKeyCiphertext !== null,
        enabled: row.enabled,
        autoModeEnabled: row.autoModeEnabled,
        monthlyTokenLimit: row.monthlyTokenLimit,
        version: row.version,
        presets: OPENAI_COMPATIBLE_PRESETS,
      };
    }
    const env = fromEnvironment(this.env);
    return {
      source: env ? "environment" : "none",
      provider: env?.provider ?? null,
      model: env?.model ?? null,
      baseUrl: env?.baseUrl ?? null,
      hasApiKey: Boolean(env?.apiKey),
      enabled: env !== null,
      autoModeEnabled: false,
      monthlyTokenLimit: null,
      version: 0,
      presets: OPENAI_COMPATIBLE_PRESETS,
    };
  }

  // The configuration the chat uses, with the key decrypted. Throws when the assistant is off.
  async resolve(companyId: string): Promise<ResolvedAiConfig> {
    const row = await this.prisma.aiProviderConfig.findUnique({ where: { companyId } });
    if (row) {
      if (!row.enabled) throw new AiSettingsError("DISABLED");
      const apiKey = row.apiKeyCiphertext ? openText(row.apiKeyCiphertext, this.key()) : undefined;
      return {
        provider: { provider: row.provider as ProviderKind, model: row.model, apiKey, baseUrl: row.baseUrl ?? undefined },
        autoModeEnabled: row.autoModeEnabled,
        monthlyTokenLimit: row.monthlyTokenLimit,
      };
    }
    const env = fromEnvironment(this.env);
    if (!env) throw new AiSettingsError("NOT_CONFIGURED");
    return { provider: env, autoModeEnabled: false, monthlyTokenLimit: null };
  }

  async update(input: UpdateAiSettingsInput, actor: { id: string; companyId: string }, correlationId: string): Promise<AiSettingsView> {
    validate(input);
    const existing = await this.prisma.aiProviderConfig.findUnique({ where: { companyId: actor.companyId } });
    if (existing && existing.version !== input.version) throw new AiSettingsError("VERSION_CONFLICT");
    let apiKeyCiphertext: Uint8Array | null | undefined;
    if (input.apiKey === undefined) apiKeyCiphertext = undefined;
    else if (input.apiKey === null || input.apiKey.trim() === "") apiKeyCiphertext = null;
    else apiKeyCiphertext = sealText(input.apiKey.trim(), this.key());
    if (needsKey(input.provider) && apiKeyCiphertext === null) throw new AiSettingsError("API_KEY_REQUIRED");
    if (needsKey(input.provider) && apiKeyCiphertext === undefined && !existing?.apiKeyCiphertext) throw new AiSettingsError("API_KEY_REQUIRED");

    const data = {
      provider: input.provider,
      model: input.model.trim(),
      baseUrl: input.baseUrl?.trim() || null,
      enabled: input.enabled,
      autoModeEnabled: input.autoModeEnabled,
      monthlyTokenLimit: input.monthlyTokenLimit ?? null,
      updatedBy: actor.id,
      ...(apiKeyCiphertext !== undefined ? { apiKeyCiphertext: apiKeyCiphertext === null ? null : Buffer.from(apiKeyCiphertext) } : {}),
    };
    const before = existing ? redact(existing) : null;
    const row = existing
      ? await this.prisma.aiProviderConfig.update({ where: { id: existing.id, version: existing.version }, data: { ...data, version: { increment: 1 } } })
      : await this.prisma.aiProviderConfig.create({ data: { id: newId(), companyId: actor.companyId, createdBy: actor.id, ...data } });
    await this.audit.log({
      actorId: actor.id,
      action: existing ? "ai_settings.updated" : "ai_settings.created",
      entityType: "AiProviderConfig",
      entityId: row.id,
      ...(before ? { before } : {}),
      after: redact(row),
      correlationId,
    });
    return this.view(actor.companyId);
  }

  // Sends one tiny request with one tool, so a model that cannot call tools is caught before use.
  async test(companyId: string, candidate?: UpdateAiSettingsInput): Promise<{ ok: boolean; ms: number; toolCalling: boolean; errorCode?: string }> {
    let config: ProviderConfig;
    if (candidate) {
      validate(candidate);
      const stored = await this.prisma.aiProviderConfig.findUnique({ where: { companyId } });
      const storedKey = stored?.apiKeyCiphertext ? openText(stored.apiKeyCiphertext, this.key()) : undefined;
      // A key typed into the form wins; otherwise test with the stored one.
      const typed = candidate.apiKey?.trim();
      const apiKey = typed ? typed : storedKey;
      config = { provider: candidate.provider, model: candidate.model, baseUrl: candidate.baseUrl ?? undefined, apiKey };
    } else {
      config = (await this.resolve(companyId)).provider;
    }
    const started = Date.now();
    try {
      const { z } = await import("zod");
      const model = await createChatModel(config);
      if (typeof model.bindTools !== "function") return { ok: false, ms: Date.now() - started, toolCalling: false, errorCode: "NO_TOOL_SUPPORT" };
      const reply = await model
        .bindTools([{ name: "get_time", description: "Returns the current time for a city.", schema: z.object({ city: z.string() }) }])
        .invoke("What time is it in Riyadh? Use the tool.");
      return { ok: true, ms: Date.now() - started, toolCalling: (reply.tool_calls?.length ?? 0) > 0 };
    } catch (error) {
      return { ok: false, ms: Date.now() - started, toolCalling: false, errorCode: providerErrorCode(error) };
    }
  }

  private key(): Buffer {
    try {
      return loadKey(AI_KEY_ENV);
    } catch {
      throw new AiSettingsError("ENCRYPTION_KEY_MISSING");
    }
  }
}

function needsKey(p: ProviderKind): boolean {
  return p === "google" || p === "anthropic" || p === "openai";
}

function validate(input: UpdateAiSettingsInput): void {
  if (!PROVIDERS.includes(input.provider)) throw new AiSettingsError("INVALID_PROVIDER");
  if (!input.model?.trim() || input.model.length > 120) throw new AiSettingsError("MODEL_REQUIRED");
  if ((input.provider === "openai-compatible" || input.provider === "ollama") && !input.baseUrl?.trim()) throw new AiSettingsError("BASE_URL_REQUIRED");
}

function redact(row: { provider: string; model: string; baseUrl: string | null; enabled: boolean; autoModeEnabled: boolean; monthlyTokenLimit: number | null; apiKeyCiphertext: Uint8Array | null }) {
  return { provider: row.provider, model: row.model, baseUrl: row.baseUrl, enabled: row.enabled, autoModeEnabled: row.autoModeEnabled, monthlyTokenLimit: row.monthlyTokenLimit, hasApiKey: row.apiKeyCiphertext !== null };
}

// Provider errors can echo request details; only a coarse code leaves the server.
export function providerErrorCode(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/API_KEY_REQUIRED|BASE_URL_REQUIRED|MODEL_REQUIRED/.test(text)) return text.match(/API_KEY_REQUIRED|BASE_URL_REQUIRED|MODEL_REQUIRED/)?.[0] ?? "CONFIG";
  if (/401|403|api key|unauthor|permission/i.test(text)) return "AUTH_FAILED";
  if (/404|not found|no longer available/i.test(text)) return "MODEL_NOT_FOUND";
  if (/429|quota|rate/i.test(text)) return "RATE_LIMITED";
  if (/503|overloaded|unavailable|high demand/i.test(text)) return "PROVIDER_BUSY";
  if (/abort/i.test(text)) return "ABORTED";
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(text)) return "UNREACHABLE";
  return "PROVIDER_ERROR";
}
