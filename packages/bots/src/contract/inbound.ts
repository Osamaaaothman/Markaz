// What a chat platform sent us, normalized. Adapters produce these; the Bot Hub never looks at a
// raw Telegram update or Discord interaction.

export type ProviderId = "telegram" | "discord";

export const PROVIDER_IDS: ReadonlyArray<ProviderId> = ["telegram", "discord"];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as ReadonlyArray<string>).includes(value);
}

export interface ExternalUser {
  // Platform user id as a string (Discord snowflakes exceed Number.MAX_SAFE_INTEGER).
  readonly id: string;
  readonly handle?: string;
  readonly displayName?: string;
  // The platform client's language, e.g. "ar", "en-US". A hint only — the linked ERP user's
  // chosen language wins.
  readonly locale?: string;
}

export interface ChatTarget {
  readonly chatId: string;
  readonly isPrivate: boolean;
}

// Enough to edit or reply to a message later. `interactionToken` is Discord's 15-minute token for
// answering an interaction; Telegram leaves it unset.
export interface SentMessageRef {
  readonly chatId: string;
  readonly messageId: string;
  readonly interactionToken?: string;
}

export interface InboundFileRef {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType?: string;
  readonly size?: number;
  // Discord hands a direct CDN url; Telegram needs a getFile call first.
  readonly url?: string;
}

interface InboundBase {
  readonly provider: ProviderId;
  // Unique per platform delivery — used to drop duplicate deliveries.
  readonly eventId: string;
  readonly sender: ExternalUser;
  readonly chat: ChatTarget;
  // Discord: the interaction token, needed to answer a deferred interaction.
  readonly interactionToken?: string;
  // Telegram: the callback query id that must be answered so the button stops spinning.
  readonly ackId?: string;
  // The message the user acted on (button tap, form opened from a button).
  readonly message?: SentMessageRef;
}

export type InboundEvent =
  | (InboundBase & { readonly kind: "command"; readonly name: string; readonly args: string })
  | (InboundBase & { readonly kind: "action"; readonly actionId: string })
  | (InboundBase & { readonly kind: "form"; readonly actionId: string; readonly fields: Readonly<Record<string, string>> })
  | (InboundBase & { readonly kind: "text"; readonly text: string; readonly replyToMessageId?: string })
  | (InboundBase & { readonly kind: "file"; readonly file: InboundFileRef; readonly caption?: string });

export type InboundEventKind = InboundEvent["kind"];
