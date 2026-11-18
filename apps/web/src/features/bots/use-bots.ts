import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { apiClient } from "../../shared/api/client";

// HTTP surface of apps/api/src/bots (docs/BOTS-INTEGRATION-PLAN.md §8.5). Secrets are write-only:
// the server never sends a token back, only whether one is stored and its last 4 characters.

export type BotProvider = "telegram" | "discord";
export type BotTransport = "webhook" | "polling";
export const BOT_FEATURES = ["approvals", "alerts", "lookups", "documents", "reports", "receipts"] as const;
export type BotFeature = (typeof BOT_FEATURES)[number];
export const ALERT_TYPES = ["approval_requested", "low_stock", "zatca_problem"] as const;
export const REPORT_TYPES = ["DAILY_SUMMARY", "WEEKLY_SUMMARY", "MONTHLY_SUMMARY"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface CredentialField {
  readonly key: string;
  readonly kind: "secret" | "text" | "select";
  readonly labelKey: string;
  readonly helpKey: string;
  readonly required: boolean;
  readonly pattern?: string;
}

export interface ProviderInfo {
  readonly provider: BotProvider;
  readonly credentialFields: readonly CredentialField[];
  readonly transports: readonly BotTransport[];
}

export interface BotIdentity {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
}

export interface ConnectionView {
  readonly id: string;
  readonly provider: BotProvider;
  readonly status: "ACTIVE" | "DISABLED";
  readonly transport: BotTransport;
  readonly identity: BotIdentity | null;
  readonly publicConfig: Readonly<Record<string, string>>;
  readonly secrets: Readonly<Record<string, { readonly set: boolean; readonly last4: string | null }>>;
  readonly enabledFeatures: readonly string[];
  readonly approvalCeiling: string | null;
  readonly webhookUrl: string | null;
  readonly linkedUsers: number;
  readonly lastHealthAt: string | null;
  readonly lastHealthOk: boolean | null;
  readonly lastHealthCode: string | null;
  readonly dataSharingAcceptedAt: string;
  readonly inviteUrl: string | null;
  readonly manualStepKey: string | null;
  readonly version: number;
}

export interface BotsOverview {
  readonly encryptionKeyConfigured: boolean;
  readonly publicUrlConfigured: boolean;
  readonly webAppUrlConfigured: boolean;
  readonly connections: readonly ConnectionView[];
}

export interface LinkedUserView {
  readonly id: string;
  readonly userId: string;
  readonly userEmail: string;
  readonly userRef: string;
  readonly externalHandle: string | null;
  readonly language: string;
  readonly linkedAt: string;
  readonly unreachable: boolean;
}

export interface DeliveryView {
  readonly id: string;
  readonly kind: string;
  readonly status: "SENT" | "FAILED" | "SKIPPED";
  readonly errorCode: string | null;
  readonly userId: string | null;
  readonly createdAt: string;
}

export interface SubscriptionView {
  readonly id: string;
  readonly reportType: ReportType;
  readonly sendTime: string;
  readonly weekday: number | null;
  readonly language: "ar" | "en";
  readonly attachPdf: boolean;
}

export interface TargetView {
  readonly id: string;
  readonly chatId: string;
  readonly title: string;
  readonly subscriptions: readonly SubscriptionView[];
}

export interface MyBotView {
  readonly connectionId: string;
  readonly provider: BotProvider;
  readonly botUsername: string | null;
  readonly enabledFeatures: readonly string[];
  readonly link: {
    readonly id: string;
    readonly externalHandle: string | null;
    readonly language: "ar" | "en";
    readonly linkedAt: string;
    readonly unreachable: boolean;
    readonly quietHoursStart: string | null;
    readonly quietHoursEnd: string | null;
    readonly disabledAlerts: readonly string[];
  } | null;
  readonly subscriptions: readonly SubscriptionView[];
}

export interface LinkCode {
  readonly code: string;
  readonly expiresAt: string;
  readonly provider: BotProvider;
  readonly deepLink: string | null;
  readonly command: string;
}

export interface SubscriptionInput {
  readonly reportType: ReportType;
  readonly sendTime: string;
  readonly weekday: number | null;
  readonly language: "ar" | "en";
  readonly attachPdf: boolean;
}

// The API wraps errors as { error: { code, message } } (common/http-exception.filter.ts).
function errorBody(error: unknown): { code?: string; message?: string } {
  if (!isAxiosError(error)) return {};
  const data = error.response?.data as { error?: { code?: unknown; message?: unknown } } | undefined;
  const body = data?.error;
  return {
    ...(typeof body?.code === "string" ? { code: body.code } : {}),
    ...(typeof body?.message === "string" ? { message: body.message } : {}),
  };
}

// The server's error code (e.g. "CONNECTION_TEST_FAILED") → a translation key under bots.errors.
export function botErrorKey(error: unknown): string {
  const { code } = errorBody(error);
  return code ? `bots.errors.${code}` : "bots.errors.UNKNOWN";
}

// For CONNECTION_TEST_FAILED the server's message is the platform's reason code (UNAUTHORIZED…).
export function botErrorDetail(error: unknown): string | null {
  const { code, message } = errorBody(error);
  return code === "CONNECTION_TEST_FAILED" && message ? message : null;
}

const KEYS = {
  providers: ["bots", "providers"] as const,
  overview: ["bots", "overview"] as const,
  links: (id: string) => ["bots", "links", id] as const,
  deliveries: (id: string) => ["bots", "deliveries", id] as const,
  targets: (id: string) => ["bots", "targets", id] as const,
  mine: ["bots", "mine"] as const,
};

export function useBotProviders(enabled = true) {
  return useQuery({ queryKey: KEYS.providers, enabled, queryFn: async () => (await apiClient.get<ProviderInfo[]>("/v1/bots/providers")).data, staleTime: Infinity });
}

export function useBotsOverview(enabled = true) {
  return useQuery({ queryKey: KEYS.overview, enabled, queryFn: async () => (await apiClient.get<BotsOverview>("/v1/bots/connections")).data });
}

export function useBotLinks(connectionId: string) {
  return useQuery({ queryKey: KEYS.links(connectionId), queryFn: async () => (await apiClient.get<LinkedUserView[]>(`/v1/bots/connections/${connectionId}/links`)).data });
}

export function useBotDeliveries(connectionId: string) {
  return useQuery({ queryKey: KEYS.deliveries(connectionId), queryFn: async () => (await apiClient.get<DeliveryView[]>(`/v1/bots/connections/${connectionId}/deliveries`, { params: { limit: 100 } })).data });
}

export function useBotTargets(connectionId: string) {
  return useQuery({ queryKey: KEYS.targets(connectionId), queryFn: async () => (await apiClient.get<TargetView[]>(`/v1/bots/connections/${connectionId}/targets`)).data });
}

function useInvalidate() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["bots"] });
}

export function useTestBotConnection() {
  return useMutation({
    meta: { feedback: "silent" },
    mutationFn: async (input: { provider: BotProvider; credentials: Record<string, string> }) =>
      (await apiClient.post<{ identity: BotIdentity }>("/v1/bots/connections/test", input)).data,
  });
}

export function useCreateBotConnection() {
  const invalidate = useInvalidate();
  return useMutation({
    meta: { feedback: "silent" },
    mutationFn: async (input: {
      provider: BotProvider;
      transport: BotTransport;
      credentials: Record<string, string>;
      acceptDataSharing: boolean;
      enabledFeatures: string[];
      approvalCeiling: string | null;
    }) => (await apiClient.post<ConnectionView>("/v1/bots/connections", input)).data,
    onSuccess: invalidate,
  });
}

export function useUpdateBotConnection(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    meta: { feedback: "silent" },
    mutationFn: async (input: { transport?: BotTransport; credentials?: Record<string, string>; enabledFeatures?: string[]; approvalCeiling?: string | null }) =>
      (await apiClient.patch<ConnectionView>(`/v1/bots/connections/${id}`, input)).data,
    onSuccess: invalidate,
  });
}

export function useBotConnectionAction(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    meta: { feedback: "silent" },
    mutationFn: async (action: "install" | "enable" | "disable" | "delete") => {
      if (action === "delete") await apiClient.delete(`/v1/bots/connections/${id}`);
      else await apiClient.post(`/v1/bots/connections/${id}/${action}`);
    },
    onSuccess: invalidate,
  });
}

export function useRevokeBotLink(connectionId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (linkId: string) => { await apiClient.delete(`/v1/bots/connections/${connectionId}/links/${linkId}`); },
    onSuccess: invalidate,
  });
}

export function useAddBotTarget(connectionId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    meta: { feedback: "silent" },
    mutationFn: async (input: { chatId: string; title: string }) => (await apiClient.post<{ id: string }>(`/v1/bots/connections/${connectionId}/targets`, input)).data,
    onSuccess: invalidate,
  });
}

export function useRemoveBotTarget(connectionId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (targetId: string) => { await apiClient.delete(`/v1/bots/connections/${connectionId}/targets/${targetId}`); },
    onSuccess: invalidate,
  });
}

export function useAddTargetSubscription(connectionId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { targetId: string } & SubscriptionInput) => {
      const { targetId, ...body } = input;
      return (await apiClient.post<{ id: string }>(`/v1/bots/connections/${connectionId}/targets/${targetId}/subscriptions`, body)).data;
    },
    onSuccess: invalidate,
  });
}

export function useRemoveTargetSubscription(connectionId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (subscriptionId: string) => { await apiClient.delete(`/v1/bots/connections/${connectionId}/subscriptions/${subscriptionId}`); },
    onSuccess: invalidate,
  });
}

// ── the signed-in user's own chat accounts ─────────────────────────────────────────────────

export function useMyBots() {
  return useQuery({ queryKey: KEYS.mine, queryFn: async () => (await apiClient.get<MyBotView[]>("/v1/bots/me")).data });
}

export function useCreateLinkCode() {
  return useMutation({
    meta: { feedback: "silent" },
    mutationFn: async (input: { connectionId: string; language: "ar" | "en" }) => (await apiClient.post<LinkCode>("/v1/bots/me/link-codes", input)).data,
  });
}

export function useUnlinkMine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (linkId: string) => { await apiClient.delete(`/v1/bots/me/links/${linkId}`); },
    onSuccess: invalidate,
  });
}

export function useUpdateMyPreferences() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { linkId: string; language?: "ar" | "en"; quietHoursStart?: string | null; quietHoursEnd?: string | null; disabledAlerts?: string[] }) => {
      const { linkId, ...body } = input;
      await apiClient.put(`/v1/bots/me/links/${linkId}/preferences`, body);
    },
    onSuccess: invalidate,
  });
}

export function useSubscribeMine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { connectionId: string } & SubscriptionInput) => (await apiClient.post<{ id: string }>("/v1/bots/me/subscriptions", input)).data,
    onSuccess: invalidate,
  });
}

export function useUnsubscribeMine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (subscriptionId: string) => { await apiClient.delete(`/v1/bots/me/subscriptions/${subscriptionId}`); },
    onSuccess: invalidate,
  });
}
