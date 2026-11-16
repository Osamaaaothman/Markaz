import type { Action, BotMessage, ButtonStyle, FormSpec } from "../contract/ui-kit.js";
import { ICON_EMOJI, TONE_COLOR, TONE_MARKER, chunk, isolate, parseHexColor, truncate } from "../render/common.js";

// Discord: one embed carrying the accent colour, fields in columns, and up to five rows of
// buttons / select menus. Limits from discord.com/developers/docs (embeds, message components).

const EMBED_TITLE = 256;
const EMBED_DESCRIPTION = 4096;
const EMBED_FIELDS = 25;
const FIELD_NAME = 256;
const FIELD_VALUE = 1024;
const FOOTER = 2048;
const BUTTON_LABEL = 80;
const SELECT_OPTIONS = 25;
const MAX_ROWS = 5;
const BUTTONS_PER_ROW = 5;

const BUTTON_STYLE: Readonly<Record<ButtonStyle, number>> = { primary: 1, secondary: 2, success: 3, danger: 4 };
const LINK_STYLE = 5;

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline: boolean }[];
  footer?: { text: string };
}

export type DiscordComponent =
  | { type: 2; style: number; label: string; custom_id?: string; url?: string; emoji?: { name: string } }
  | { type: 3; custom_id: string; placeholder: string; options: { label: string; value: string; description?: string; emoji?: { name: string } }[] };

export interface DiscordRendered {
  content: string;
  embeds: DiscordEmbed[];
  components: { type: 1; components: DiscordComponent[] }[];
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\*_~`|>[\]])/g, "\\$1");
}

function emoji(icon: keyof typeof ICON_EMOJI | undefined): { emoji?: { name: string } } {
  return icon ? { emoji: { name: ICON_EMOJI[icon] } } : {};
}

function renderActionRow(items: ReadonlyArray<Action<string>>, selectIndex: { value: number }): { type: 1; components: DiscordComponent[] }[] {
  const rows: { type: 1; components: DiscordComponent[] }[] = [];
  const buttons: DiscordComponent[] = [];
  for (const action of items) {
    if (action.type === "button") {
      buttons.push({ type: 2, style: BUTTON_STYLE[action.style], label: truncate(action.label, BUTTON_LABEL), custom_id: action.action, ...emoji(action.icon) });
    } else if (action.type === "link") {
      buttons.push({ type: 2, style: LINK_STYLE, label: truncate(action.label, BUTTON_LABEL), url: action.url, ...emoji(action.icon) });
    } else {
      // A select menu fills a whole row. Its own custom_id only needs to be unique in the
      // message — the chosen option's value carries the action token.
      rows.push({
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `select:${selectIndex.value++}`,
            placeholder: truncate(action.placeholder, 150),
            options: action.options.slice(0, SELECT_OPTIONS).map((o) => ({
              label: truncate(o.label, 100),
              value: o.action,
              ...(o.description ? { description: truncate(o.description, 100) } : {}),
              ...emoji(o.icon),
            })),
          },
        ],
      });
    }
  }
  return [...chunk(buttons, BUTTONS_PER_ROW).map((components) => ({ type: 1 as const, components })), ...rows];
}

export function renderDiscord(message: BotMessage): DiscordRendered {
  const embed: DiscordEmbed = {};
  const description: string[] = [];
  const fields: { name: string; value: string; inline: boolean }[] = [];
  for (const block of message.blocks) {
    switch (block.type) {
      case "header":
        embed.title = truncate(`${ICON_EMOJI[block.icon]} ${block.title}`, EMBED_TITLE);
        embed.color = block.tone === "brand" ? (parseHexColor(message.brandColor) ?? TONE_COLOR.brand) : TONE_COLOR[block.tone];
        if (block.subtitle) description.push(`*${escapeMarkdown(block.subtitle)}*`);
        break;
      case "text":
        description.push(
          block.emphasis === "strong" ? `**${escapeMarkdown(block.text)}**` : block.emphasis === "muted" ? `*${escapeMarkdown(block.text)}*` : escapeMarkdown(block.text),
        );
        break;
      case "fields":
        for (const f of block.items) {
          fields.push({
            name: truncate(`${f.tone ? `${TONE_MARKER[f.tone]} ` : ""}${f.label}`, FIELD_NAME),
            value: truncate(isolate(f.value) || "—", FIELD_VALUE),
            inline: f.inline ?? true,
          });
        }
        break;
      case "list":
        for (const item of block.items) {
          const marker = item.icon ? ICON_EMOJI[item.icon] : item.tone ? TONE_MARKER[item.tone] : "•";
          description.push(`${marker} **${escapeMarkdown(item.title)}**${item.detail ? ` — ${isolate(escapeMarkdown(item.detail))}` : ""}`);
        }
        break;
      case "divider":
        description.push("");
        break;
      case "footer":
        embed.footer = { text: truncate(block.text, FOOTER) };
        break;
    }
  }
  if (description.length > 0) embed.description = truncate(description.join("\n"), EMBED_DESCRIPTION);
  if (fields.length > 0) embed.fields = fields.slice(0, EMBED_FIELDS);

  const selectIndex = { value: 0 };
  const components = (message.actions ?? []).flatMap((row) => renderActionRow(row.items, selectIndex)).slice(0, MAX_ROWS);
  return { content: "", embeds: [embed], components };
}

// A modal (type 9 interaction response) with one text input per field.
export function renderDiscordModal(actionId: string, spec: FormSpec): unknown {
  return {
    type: 9,
    data: {
      custom_id: actionId,
      title: truncate(spec.title, 45),
      components: spec.fields.slice(0, 5).map((f) => ({
        type: 1,
        components: [
          {
            type: 4,
            custom_id: f.key,
            label: truncate(f.label, 45),
            style: f.multiline ? 2 : 1,
            required: f.required,
            max_length: Math.min(f.maxLength, 4000),
            ...(f.placeholder ? { placeholder: truncate(f.placeholder, 100) } : {}),
          },
        ],
      })),
    },
  };
}
