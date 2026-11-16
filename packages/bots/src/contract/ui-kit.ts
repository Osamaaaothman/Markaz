// The Bot UI Kit (docs/BOTS-INTEGRATION-PLAN.md §4): a platform-neutral description of one chat
// message. Features build this tree; each adapter's renderer turns it into the richest thing its
// platform supports. Every string in here is ALREADY translated by the Bot Hub — adapters never
// see a translation key and never choose wording, they only choose presentation.

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "brand";

// A closed set so features never type an emoji or icon literal; each renderer maps it.
export type IconKey =
  | "invoice"
  | "cash"
  | "stock"
  | "approval"
  | "customer"
  | "supplier"
  | "report"
  | "zatca"
  | "alert"
  | "calendar"
  | "file"
  | "chart"
  | "settings"
  | "link"
  | "menu"
  | "search"
  | "check"
  | "cross"
  | "back"
  | "next"
  | "previous"
  | "pdf"
  | "excel";

export type TextDirection = "rtl" | "ltr";

export type Block =
  | { readonly type: "header"; readonly tone: Tone; readonly icon: IconKey; readonly title: string; readonly subtitle?: string }
  | { readonly type: "text"; readonly text: string; readonly emphasis?: "normal" | "muted" | "strong" }
  | { readonly type: "fields"; readonly items: ReadonlyArray<Field> }
  | { readonly type: "list"; readonly items: ReadonlyArray<ListItem> }
  | { readonly type: "divider" }
  | { readonly type: "footer"; readonly text: string };

export interface Field {
  readonly label: string;
  // Already formatted for display (money is formatted by the Bot Hub from a decimal string —
  // a JavaScript number never reaches this tree; CLAUDE.md invariant 3).
  readonly value: string;
  readonly tone?: Tone;
  readonly inline?: boolean;
  // Tap-to-copy on platforms that support it (reference numbers, phones, VAT numbers).
  readonly copy?: boolean;
  // The figure the reader is looking for (a balance, a total).
  readonly strong?: boolean;
}

export interface ListItem {
  readonly icon?: IconKey;
  readonly tone?: Tone;
  readonly title: string;
  readonly detail?: string;
}

export type ButtonStyle = "primary" | "secondary" | "success" | "danger";

// `A` is the action reference. Features use an intent object; the Bot Hub replaces it with a short
// opaque token string before the tree reaches an adapter (BotMessage<string>).
export type Action<A> =
  | { readonly type: "button"; readonly style: ButtonStyle; readonly label: string; readonly icon?: IconKey; readonly action: A }
  | { readonly type: "link"; readonly label: string; readonly icon?: IconKey; readonly url: string }
  | { readonly type: "select"; readonly placeholder: string; readonly options: ReadonlyArray<SelectOption<A>> };

export interface SelectOption<A> {
  readonly label: string;
  readonly description?: string;
  readonly icon?: IconKey;
  readonly action: A;
}

export interface ActionRow<A> {
  readonly items: ReadonlyArray<Action<A>>;
}

export interface BotMessage<A = string> {
  readonly direction: TextDirection;
  readonly blocks: ReadonlyArray<Block>;
  readonly actions?: ReadonlyArray<ActionRow<A>>;
  // Accent colour override for `brand` tone (hex, "#RRGGBB"); renderers without colour ignore it.
  readonly brandColor?: string;
}

// A small form (reason for a rejection, a search term). Discord shows a modal; Telegram asks with
// a reply prompt and collects the answer from the next message.
export interface FormSpec {
  readonly title: string;
  readonly fields: ReadonlyArray<FormField>;
}

export interface FormField {
  readonly key: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly multiline: boolean;
  readonly required: boolean;
  readonly maxLength: number;
}

// A question the bot asks in free text (platforms without pop-up forms).
export interface PromptSpec {
  readonly title: string;
  readonly hint: string;
  readonly placeholder?: string;
}

export interface OutboundFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}
