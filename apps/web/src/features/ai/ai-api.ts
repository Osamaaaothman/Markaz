import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { useAuthStore } from "../../shared/auth/auth-store";

// HTTP surface of apps/api/src/ai (docs/Planning/ai-assistant-plan.md). The provider key is write-only.

export type AssistantMode = "ask" | "review" | "auto";
export type ProviderKind = "google" | "anthropic" | "openai" | "openai-compatible" | "ollama";

export type DisplayBlock =
  | { kind: "kpis"; titleKey: string; items: Array<{ labelKey: string; value: string; format: "money" | "number" | "text"; currency?: string }> }
  | { kind: "table"; titleKey: string; columns: Array<{ key: string; labelKey: string; format?: "money" | "number" | "text" | "date" }>; rows: Array<Record<string, string>>; link?: string }
  | { kind: "chart"; titleKey: string; chartType: "bar" | "line"; labels: string[]; series: Array<{ labelKey: string; values: string[] }> }
  | { kind: "links"; titleKey: string; items: Array<{ label: string; path: string; hint?: string }> }
  | { kind: "clarify"; question: string; options: string[] }
  // Question mode was asked to change data; `text` is the request to resend after switching.
  | { kind: "needsMode"; text?: string }
  // A document the user attached to their own message.
  | { kind: "upload"; name: string; contentType: string; sizeBytes: number }
  | { kind: "file"; titleKey: string; label: string; apiPath: string; filename: string; openPath?: string; meta?: Array<{ labelKey: string; value: string; format?: "money" | "date" | "text" }>; currency?: string };

export interface ChangePreview {
  titleKey: string;
  entity: string;
  fields: Array<{ labelKey: string; value: string; before?: string }>;
  warningKeys?: string[];
}

export type ChangeStatus = "PROPOSED" | "EXECUTED" | "REJECTED" | "SKIPPED" | "FAILED";

export interface ChangeItem {
  key: string;
  tool: string;
  args: Record<string, unknown>;
  preview: ChangePreview;
  risk: "low" | "high";
  status: ChangeStatus;
  auto: boolean;
  dependsOn: string[];
  link: { label: string; path: string } | null;
  errorCode: string | null;
}

export interface TimelineStep {
  callId?: string;
  tool: string;
  ok?: boolean;
  ms?: number;
  errorCode?: string;
  running?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "divider";
  text: string | null;
  blocks: DisplayBlock[];
  timeline: TimelineStep[];
  errorCode: string | null;
  changes: ChangeItem[];
  createdAt?: string;
  streaming?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  mode: AssistantMode;
  status: "IDLE" | "AWAITING_APPROVAL";
  pinned: boolean;
  updatedAt: string;
  // A turn is still being worked on by the server (e.g. the page was refreshed mid-answer).
  running?: boolean;
}

export interface ConversationDetail {
  conversation: { id: string; title: string; mode: AssistantMode; status: "IDLE" | "AWAITING_APPROVAL"; pinned: boolean; running?: boolean };
  messages: ChatMessage[];
}

export interface AiMe {
  configured: boolean;
  autoModeEnabled: boolean;
  provider: ProviderKind | null;
  model: string | null;
  usage: { input: number; output: number; requests: number };
}

export interface AiSettings {
  source: "database" | "environment" | "none";
  provider: ProviderKind | null;
  model: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  enabled: boolean;
  autoModeEnabled: boolean;
  monthlyTokenLimit: number | null;
  version: number;
  presets: Record<string, string>;
  usage: { input: number; output: number; requests: number };
}

export interface AiSettingsInput {
  provider: ProviderKind;
  model: string;
  baseUrl?: string | null;
  apiKey?: string | null | undefined;
  enabled: boolean;
  autoModeEnabled: boolean;
  monthlyTokenLimit?: number | null;
  version: number;
}

// Everything the server streams (apps/api/src/ai/ai-chat.service.ts ChatEvent).
export type ChatEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "token"; text: string }
  | { type: "tool_start"; callId: string; tool: string }
  | { type: "tool_end"; callId: string; tool: string; ok: boolean; ms: number; errorCode?: string }
  | { type: "display"; block: DisplayBlock }
  | { type: "clarify"; question: string; options: string[] }
  | { type: "needs_mode" }
  | { type: "provider_busy"; next: number }
  | { type: "proposed"; item: { id: string; tool: string; args: Record<string, unknown>; preview: ChangePreview; risk: "low" | "high"; dependsOn: string[] } }
  | { type: "executed"; item: { id: string; tool: string; args: Record<string, unknown>; result: { data: Record<string, unknown>; link?: { label: string; path: string } } } }
  | { type: "outcome"; outcome: { key: string; status: "EXECUTED" | "REJECTED" | "SKIPPED" | "FAILED"; link?: { label: string; path: string } | null; errorCode?: string } }
  | { type: "step_limit" }
  | { type: "compacted"; compactions: number }
  | { type: "done"; messageId: string; status: "IDLE" | "AWAITING_APPROVAL"; usage: { input: number; output: number } }
  | { type: "error"; code: string };

export const aiKeys = {
  me: ["ai", "me"] as const,
  conversations: ["ai", "conversations"] as const,
  conversation: (id: string) => ["ai", "conversations", id] as const,
  settings: ["ai", "settings"] as const,
  accessTokens: ["ai", "access-tokens"] as const,
  mcpActivity: ["ai", "mcp-activity"] as const,
};

export function useAiMe(enabled: boolean) {
  return useQuery({ queryKey: aiKeys.me, enabled, staleTime: 60_000, queryFn: async () => (await apiClient.get<AiMe>("/v1/ai/me")).data });
}

export function useConversations(enabled: boolean) {
  return useQuery({ queryKey: aiKeys.conversations, enabled, queryFn: async () => (await apiClient.get<ConversationSummary[]>("/v1/ai/conversations")).data });
}

// Only this stops a turn: closing the tab or refreshing leaves it running on the server.
export async function stopConversation(id: string): Promise<void> {
  await apiClient.post(`/v1/ai/conversations/${id}/stop`);
}

export async function fetchConversation(id: string): Promise<ConversationDetail> {
  return (await apiClient.get<ConversationDetail>(`/v1/ai/conversations/${id}`)).data;
}

export function useUpdateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; title?: string; pinned?: boolean; archived?: boolean }) => { await apiClient.patch(`/v1/ai/conversations/${id}`, patch); },
    onSuccess: () => qc.invalidateQueries({ queryKey: aiKeys.conversations }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await apiClient.delete(`/v1/ai/conversations/${id}`); },
    onSuccess: () => qc.invalidateQueries({ queryKey: aiKeys.conversations }),
  });
}

export function useAiSettings(enabled: boolean) {
  return useQuery({ queryKey: aiKeys.settings, enabled, queryFn: async () => (await apiClient.get<AiSettings>("/v1/ai/settings")).data });
}

export function useSaveAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AiSettingsInput) => (await apiClient.put<AiSettings>("/v1/ai/settings", input)).data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: aiKeys.settings }); void qc.invalidateQueries({ queryKey: aiKeys.me }); },
  });
}

export function useTestAiSettings() {
  return useMutation({
    mutationFn: async (input: AiSettingsInput) => (await apiClient.post<{ ok: boolean; ms: number; toolCalling: boolean; errorCode?: string }>("/v1/ai/settings/test", input)).data,
  });
}

export class ChatHttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

// Server-Sent Events over POST. EventSource cannot POST or send the auth header, so this reads the
// response body by hand. Axios is not used because it buffers the whole response.
// A 401 refreshes the session once through the axios client (same refresh logic) and retries.
export async function streamChat(path: string, body: unknown, onEvent: (e: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  // FormData (a message with a file) sets its own multipart content type.
  const form = body instanceof FormData;
  const send = (): Promise<Response> =>
    fetch(`/api${path}`, {
      method: "POST",
      headers: { ...(form ? {} : { "content-type": "application/json" }), authorization: `Bearer ${useAuthStore.getState().accessToken ?? ""}` },
      body: form ? body : JSON.stringify(body),
      signal,
    });
  let res = await send();
  if (res.status === 401) {
    // Any cheap authenticated GET makes the axios interceptor refresh the token.
    await apiClient.get("/v1/ai/me").catch(() => undefined);
    res = await send();
  }
  if (!res.ok || !res.body) {
    let code = "INTERNAL";
    try { code = ((await res.json()) as { code?: string; error?: { code?: string } }).code ?? "HTTP_" + res.status; } catch { /* not JSON */ }
    throw new ChatHttpError(res.status, code);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let index: number;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as ChatEvent);
      } catch {
        // A malformed frame is skipped, never shown.
      }
    }
  }
}

// ─── Editing a waiting card ───
// The tool's input as JSON Schema (generated on the server from the same schema that validates it).
export interface FormSchema {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, FormSchema>;
  required?: string[];
  items?: FormSchema;
  pattern?: string;
  anyOf?: FormSchema[];
  minItems?: number;
  maxItems?: number;
}

export async function fetchItemForm(conversationId: string, key: string): Promise<{ schema: FormSchema; args: Record<string, unknown> }> {
  return (await apiClient.get<{ schema: FormSchema; args: Record<string, unknown> }>(`/v1/ai/conversations/${conversationId}/items/${key}/form`)).data;
}

export async function reviseItem(conversationId: string, key: string, args: Record<string, unknown>, locale: string): Promise<{ args: Record<string, unknown>; preview: ChangePreview }> {
  return (await apiClient.put<{ args: Record<string, unknown>; preview: ChangePreview }>(`/v1/ai/conversations/${conversationId}/items/${key}`, { args, locale: locale === "ar" ? "ar" : "en" })).data;
}

// Personal tokens for the read-only MCP endpoint. `token` exists only in the create response.
// read: read only. review: changes become cards to approve. write: low-risk changes are saved at once.
export type AccessTokenScope = "read" | "review" | "write";

export interface AccessToken {
  id: string;
  name: string;
  scope: AccessTokenScope;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function useAccessTokens() {
  return useQuery({ queryKey: aiKeys.accessTokens, queryFn: async () => (await apiClient.get<AccessToken[]>("/v1/ai/access-tokens")).data });
}

export function useCreateAccessToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; scope: AccessTokenScope }) => (await apiClient.post<AccessToken & { token: string }>("/v1/ai/access-tokens", input)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: aiKeys.accessTokens }),
  });
}

export function useRevokeAccessToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await apiClient.delete(`/v1/ai/access-tokens/${encodeURIComponent(id)}`); },
    onSuccess: () => void qc.invalidateQueries({ queryKey: aiKeys.accessTokens }),
  });
}

// A card or change that came in through one of the user's MCP tokens.
export interface McpActivityItem {
  id: string;
  key: string;
  conversationId: string;
  tokenName: string;
  tool: string;
  status: ChangeStatus;
  titleKey: string | null;
  createdAt: string;
}

// Polled while the app is open so the bell can ring when Claude sends something new.
export function useMcpActivity(enabled: boolean) {
  return useQuery({
    queryKey: aiKeys.mcpActivity,
    enabled,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    queryFn: async () => (await apiClient.get<McpActivityItem[]>("/v1/ai/mcp-activity")).data,
  });
}
