import type { BotMessage, ChannelAdapter, ConnectionSecrets, FormSpec, InboundEvent, OutboundFile } from "@erp/bots";
import type { TFunction } from "i18next";
import type { BotLanguage } from "./bot-core.js";
import type { BotFormatter } from "./bot-format.js";
import type { BotFeatureKey } from "./bot-connection.service.js";

// What a button means. Stored server-side behind a short token (bot_action_tokens); a client only
// ever sees the token. `f` = feature key, `a` = action name inside that feature.
export interface Intent {
  readonly f: string;
  readonly a: string;
  readonly p?: Readonly<Record<string, string>>;
  // State-changing actions: the token works once.
  readonly once?: boolean;
  // Opens this feature form before running the action (e.g. a rejection reason).
  readonly form?: string;
  readonly ttlHours?: number;
}

export type FeatureMessage = BotMessage<Intent>;

export interface ConnectionInfo {
  readonly id: string;
  readonly companyId: string;
  readonly provider: string;
  readonly enabledFeatures: ReadonlyArray<string>;
  readonly approvalCeiling: string | null;
  readonly timezone: string;
  readonly currency: string;
  readonly companyName: string;
  readonly companyNameAr: string | null;
}

export interface LinkedUser {
  readonly linkId: string;
  readonly userId: string;
  readonly language: BotLanguage;
  readonly privateChatId: string;
  readonly quietHoursStart: string | null;
  readonly quietHoursEnd: string | null;
  readonly disabledAlerts: ReadonlyArray<string>;
}

// Everything a feature needs to build a message for one ERP user, with or without an inbound event.
export interface BotUserContext {
  readonly connection: ConnectionInfo;
  readonly user: LinkedUser;
  readonly language: BotLanguage;
  readonly t: TFunction;
  readonly fmt: BotFormatter;
  readonly correlationId: string;
  can(action: string, resource: string): Promise<boolean>;
  // Deep link into the web app, or null when BOTS_WEB_APP_URL is not set.
  webUrl(path: string): string | null;
  featureEnabled(feature: BotFeatureKey): boolean;
}

// An interactive request from a linked user.
export interface BotContext extends BotUserContext {
  readonly event: InboundEvent;
  readonly adapter: ChannelAdapter;
  readonly secrets: ConnectionSecrets;
  reply(message: FeatureMessage, mode?: "replace" | "new"): Promise<void>;
  replyFile(file: OutboundFile, caption?: FeatureMessage): Promise<void>;
  // Short notice on the tapped button (Telegram toast); ignored where unsupported.
  toast(text: string): Promise<void>;
  // Remember a message about a record so it can be updated later.
  trackLastReply(subjectType: string, subjectId: string): Promise<void>;
}

export type CommandHandler = (ctx: BotContext, args: string) => Promise<void>;
export type ActionHandler = (ctx: BotContext, params: Readonly<Record<string, string>>, fields: Readonly<Record<string, string>>) => Promise<void>;

export interface BotFeature {
  readonly key: string;
  // Feature toggle on the connection; menu and account commands have none (always on).
  readonly toggle?: BotFeatureKey;
  readonly commands?: Readonly<Record<string, CommandHandler>>;
  readonly actions?: Readonly<Record<string, ActionHandler>>;
  readonly forms?: Readonly<Record<string, (ctx: BotUserContext) => FormSpec>>;
  // Files sent to the bot (only one feature may claim them).
  readonly onFile?: (ctx: BotContext) => Promise<void>;
}
