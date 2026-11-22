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
      return new ChatGoogleGenerativeAI({ model: cfg.model, apiKey: key(), temperature: 0, maxRetries: 1 });
    }
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic({ model: cfg.model, apiKey: key(), temperature: 0, maxRetries: 1 });
    }
    case "openai": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({ model: cfg.model, apiKey: key(), temperature: 0, maxRetries: 1 });
    }
    case "openai-compatible": {
      if (!cfg.baseUrl) throw new ProviderConfigError("BASE_URL_REQUIRED");
      const { ChatOpenAI } = await import("@langchain/openai");
      // Local servers (LM Studio) accept any key; the client library insists on one.
      return new ChatOpenAI({ model: cfg.model, apiKey: cfg.apiKey ?? "not-needed", temperature: 0, maxRetries: 1, configuration: { baseURL: cfg.baseUrl } });
    }
    case "ollama": {
      if (!cfg.baseUrl) throw new ProviderConfigError("BASE_URL_REQUIRED");
      const { ChatOllama } = await import("@langchain/ollama");
      return new ChatOllama({ model: cfg.model, baseUrl: cfg.baseUrl, temperature: 0 });
    }
  }
}
