import type { Action, BotMessage, Block, Field, IconKey, ListItem, PromptSpec } from "../contract/ui-kit.js";
import { ICON_EMOJI, TONE_MARKER, chunk, truncate } from "../render/common.js";

// Telegram rendering (parse_mode HTML, core.telegram.org/bots/api#html-style). Telegram has no
// colours or columns, so structure comes from its own formatting:
//   header      → one icon + bold title, italic subtitle
//   fields      → a <blockquote> card; key figures bold, reference numbers in <code> (tap to copy)
//   long lists  → an expandable <blockquote> so the chat stays short
//   tone        → a coloured dot only where a value carries a status
// No Unicode direction marks: Telegram lays out each line by its own script, and invisible
// marks end up in whatever the user copies.

export const TELEGRAM_TEXT_LIMIT = 4096;
export const TELEGRAM_CAPTION_LIMIT = 1024;
const BUTTONS_PER_ROW = 2;
const EXPAND_LIST_AFTER = 6;
const STATUS_TONES = new Set(["success", "warning", "danger"]);

export interface TelegramInlineButton {
  readonly text: string;
  readonly callback_data?: string;
  readonly url?: string;
}

export interface TelegramRendered {
  readonly text: string;
  readonly reply_markup?: { readonly inline_keyboard: TelegramInlineButton[][] };
}

export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const esc = escapeTelegramHtml;

function fieldValue(field: Field): string {
  if (field.copy) return `<code>${esc(field.value)}</code>`;
  if (field.strong) return `<b>${esc(field.value)}</b>`;
  return esc(field.value);
}

function fieldLine(field: Field): string {
  const dot = field.tone && STATUS_TONES.has(field.tone) ? `${TONE_MARKER[field.tone]} ` : "";
  return `${dot}${esc(field.label)}: ${fieldValue(field)}`;
}

function listMarker(item: ListItem): string {
  if (item.icon) return ICON_EMOJI[item.icon];
  if (item.tone && STATUS_TONES.has(item.tone)) return TONE_MARKER[item.tone];
  return "▸";
}

function listLine(item: ListItem): string {
  const detail = item.detail ? `\n     <i>${esc(item.detail)}</i>` : "";
  return `${listMarker(item)} <b>${esc(item.title)}</b>${detail}`;
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case "header": {
      const title = `${ICON_EMOJI[block.icon]} <b>${esc(block.title)}</b>`;
      return block.subtitle ? `${title}\n<i>${esc(block.subtitle)}</i>` : title;
    }
    case "text":
      if (block.emphasis === "strong") return `<b>${esc(block.text)}</b>`;
      if (block.emphasis === "muted") return `<i>${esc(block.text)}</i>`;
      return esc(block.text);
    case "fields":
      return block.items.length > 0 ? `<blockquote>${block.items.map(fieldLine).join("\n")}</blockquote>` : "";
    case "list": {
      const lines = block.items.map(listLine).join("\n");
      // Long lists fold away; the reader taps to open them.
      return block.items.length > EXPAND_LIST_AFTER ? `<blockquote expandable>${lines}</blockquote>` : lines;
    }
    case "divider":
      return "┈┈┈┈┈┈┈┈┈┈┈┈";
    case "footer":
      return `<i>🕒 ${esc(block.text)}</i>`;
  }
}

function label(text: string, icon: IconKey | undefined): string {
  return icon ? `${ICON_EMOJI[icon]} ${text}` : text;
}

function renderAction(action: Action<string>): TelegramInlineButton[] {
  switch (action.type) {
    case "button":
      return [{ text: truncate(label(action.label, action.icon), 64), callback_data: action.action }];
    case "link":
      return [{ text: truncate(label(action.label, action.icon ?? "link"), 64), url: action.url }];
    case "select":
      // No dropdowns on Telegram: every option becomes its own button.
      return action.options.map((o) => ({ text: truncate(label(o.label, o.icon), 64), callback_data: o.action }));
  }
}

export function renderTelegram(message: BotMessage, limit: number = TELEGRAM_TEXT_LIMIT): TelegramRendered {
  // Cutting HTML mid-tag makes Telegram reject the whole message, so an over-long message drops
  // whole trailing blocks instead of characters.
  const parts: string[] = [];
  let length = 0;
  for (const part of message.blocks.map(renderBlock).filter((p) => p !== "")) {
    const added = (parts.length > 0 ? 2 : 0) + part.length;
    if (length + added > limit - 2) {
      parts.push("…");
      break;
    }
    parts.push(part);
    length += added;
  }
  const text = parts.join("\n\n");

  const keyboard: TelegramInlineButton[][] = [];
  for (const row of message.actions ?? []) {
    const selects = row.items.filter((a) => a.type === "select");
    const buttons = row.items.filter((a) => a.type !== "select").flatMap(renderAction);
    // A row the feature built with one wide button (a list entry) stays one per line.
    const perRow = buttons.length === 1 ? 1 : BUTTONS_PER_ROW;
    for (const part of chunk(buttons, perRow)) keyboard.push(part);
    for (const select of selects) for (const button of renderAction(select)) keyboard.push([button]);
  }
  return keyboard.length > 0 ? { text, reply_markup: { inline_keyboard: keyboard } } : { text };
}

export function renderTelegramPrompt(prompt: PromptSpec): string {
  return `🔍 <b>${esc(prompt.title)}</b>\n<i>${esc(prompt.hint)}</i>`;
}
