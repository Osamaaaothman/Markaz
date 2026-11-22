import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// "Any LLM" lives here and only here. Everything else in the assistant talks to LangChain's
// BaseChatModel, so changing provider is a settings change, not a code change.
//
// openai-compatible covers every provider that speaks the OpenAI chat API (Groq, OpenRouter,
// Cerebras, GitHub Models, Mistral, DeepSeek, LM Studio, vLLM, ...) — only the base URL differs.
export type ProviderKind = "google" | "anthropic" | "openai" | "openai-compatible" | "ollama";

export interface ProviderConfig {
  readonly provider: ProviderKind;
  readonly model: string;
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
  // Client-side retries on a failed call. 0 when a fallback model will be tried instead (faster).
  readonly retries?: number | undefined;
}

// Ready-made base URLs for the free / cheap OpenAI-compatible providers listed in the plan §3.1.
// Verify against each provider's docs if one stops working — these change.
export const OPENAI_COMPATIBLE_PRESETS: Readonly<Record<string, string>> = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  cerebras: "https://api.cerebras.ai/v1",
  github: "https://models.github.ai/inference",
  mistral: "https://api.mistral.ai/v1",
  lmstudio: "http://localhost:1234/v1",
};

export class ProviderConfigError extends Error {
  constructor(readonly code: "API_KEY_REQUIRED" | "BASE_URL_REQUIRED" | "MODEL_REQUIRED") {
    super(code);
    this.name = "ProviderConfigError";
  }
}

// temperature 0: an accounting system should answer the same request the same way every time.
export async function createChatModel(cfg: ProviderConfig): Promise<BaseChatModel> {
  if (!cfg.model) throw new ProviderConfigError("MODEL_REQUIRED");
  const key = (): string => {
    if (!cfg.apiKey) throw new ProviderConfigError("API_KEY_REQUIRED");
    return cfg.apiKey;
  };
  switch (cfg.provider) {
    case "google": {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      const model = new ChatGoogleGenerativeAI({ model: cfg.model, apiKey: key(), temperature: 0, maxRetries: cfg.retries ?? 1 });
      // LangChain guesses image support from the model NAME (gemini-2*, gemini-3*, ...), so an alias such
      // as "gemini-flash-lite-latest" is refused an attached invoice before Google ever sees it. Every
      // current Gemini chat model reads images and PDFs; let Google decide.
      Object.defineProperty(model, "_isMultimodalModel", { get: () => true });
      return model;
    }
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic({ model: cfg.model, apiKey: key(), temperature: 0, maxRetries: cfg.retries ?? 1 });
    }
    case "openai": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({ model: cfg.model, apiKey: key(), temperature: 0, maxRetries: cfg.retries ?? 1 });
    }
    case "openai-compatible": {
      if (!cfg.baseUrl) throw new ProviderConfigError("BASE_URL_REQUIRED");
      const { ChatOpenAI } = await import("@langchain/openai");
      // Local servers (LM Studio) accept any key; the client library insists on one.
      return new ChatOpenAI({ model: cfg.model, apiKey: cfg.apiKey ?? "not-needed", temperature: 0, maxRetries: cfg.retries ?? 1, configuration: { baseURL: cfg.baseUrl } });
    }
    case "ollama": {
      if (!cfg.baseUrl) throw new ProviderConfigError("BASE_URL_REQUIRED");
      const { ChatOllama } = await import("@langchain/ollama");
      return new ChatOllama({ model: cfg.model, baseUrl: cfg.baseUrl, temperature: 0 });
    }
  }
}

// The free tiers answer "503 high demand" or "429 quota" under load. Those are worth trying on
// another model; a bad key or a bad request is not.
// The model refused the attached file or image (it cannot read that kind of input).
export function isFilesUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not support (images|files|pdf|documents)|unsupported (mime|media|file)|image input (is )?not supported/i.test(message);
}

export function isProviderBusy(error: unknown): boolean {
  const e = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : undefined;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  const code = typeof e?.code === "string" || typeof e?.code === "number" ? String(e.code) : "";
  const text = `${code} ${typeof e?.message === "string" ? e.message : ""}`;
  return /(429|500|502|503|504)|overloaded|high demand|unavailable|resource.?exhausted|rate.?limit|timed? ?out|ETIMEDOUT|ECONNRESET/i.test(text);
}
