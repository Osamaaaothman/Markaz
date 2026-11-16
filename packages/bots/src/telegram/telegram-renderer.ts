import type { Action, BotMessage, Block } from "../contract/ui-kit.js";
import { ICON_EMOJI, TONE_MARKER, chunk, isolate, truncate } from "../render/common.js";

// Telegram has no colours and no columns: tone becomes a coloured-circle marker, fields become
// "label: value" lines, and every string goes out as escaped HTML (parse_mode HTML).

export const TELEGRAM_TEXT_LIMIT = 4096;
export const TELEGRAM_CAPTION_LIMIT = 1024;
const BUTTONS_PER_ROW = 3;

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

function renderBlock(block: Block): string {
  switch (block.type) {
    case "header": {
      const title = `${TONE_MARKER[block.tone]} ${ICON_EMOJI[block.icon]} <b>${escapeTelegramHtml(block.title)}</b>`;
      return block.subtitle ? `${title}\n<i>${escapeTelegramHtml(block.subtitle)}</i>` : title;
    }
    case "text": {
      const text = escapeTelegramHtml(block.text);
      if (block.emphasis === "strong") return `<b>${text}</b>`;
      if (block.emphasis === "muted") return `<i>${text}</i>`;
      return text;
    }
    case "fields":
      return block.items
        .map((f) => `${f.tone ? `${TONE_MARKER[f.tone]} ` : ""}<b>${escapeTelegramHtml(f.label)}:</b> ${isolate(escapeTelegramHtml(f.value))}`)
        .join("\n");
    case "list":
      return block.items
        .map((item) => {
          const marker = item.icon ? ICON_EMOJI[item.icon] : item.tone ? TONE_MARKER[item.tone] : "•";
          const detail = item.detail ? ` — ${isolate(escapeTelegramHtml(item.detail))}` : "";
          return `${marker} ${escapeTelegramHtml(item.title)}${detail}`;
        })
        .join("\n");
    case "divider":
      return "──────────";
    case "footer":
      return `<i>${escapeTelegramHtml(block.text)}</i>`;
  }
}

function label(text: string, icon: keyof typeof ICON_EMOJI | undefined): string {
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
  // Blocks are separated by a blank line. Cutting HTML mid-tag makes Telegram reject the whole
  // message, so an over-long message drops whole trailing blocks instead of characters.
  const parts: string[] = [];
  let length = 0;
  for (const part of message.blocks.map(renderBlock)) {
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
    const others = row.items.filter((a) => a.type !== "select").flatMap(renderAction);
    for (const part of chunk(others, BUTTONS_PER_ROW)) keyboard.push(part);
    // Options of a select stack one per row so long names stay readable.
    for (const select of selects) for (const button of renderAction(select)) keyboard.push([button]);
  }
  return keyboard.length > 0 ? { text, reply_markup: { inline_keyboard: keyboard } } : { text };
}
