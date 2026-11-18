import type { IconKey, Tone } from "../contract/ui-kit.js";

// Shared presentation vocabulary for every renderer, so one tone or icon looks the same on every
// platform that lacks native colours.

export const TONE_MARKER: Readonly<Record<Tone, string>> = {
  success: "🟢",
  warning: "🟡",
  danger: "🔴",
  info: "🔵",
  neutral: "▫️",
  brand: "🏢",
};

// Accent colours as 24-bit integers (Discord's embed colour format). They follow the web app's
// status colours in apps/web/src/design.
export const TONE_COLOR: Readonly<Record<Tone, number>> = {
  success: 0x2e7d32,
  warning: 0xf9a825,
  danger: 0xc62828,
  info: 0x1565c0,
  neutral: 0x607d8b,
  brand: 0x0f4c81,
};

export const ICON_EMOJI: Readonly<Record<IconKey, string>> = {
  invoice: "🧾",
  cash: "💵",
  stock: "📦",
  approval: "⏳",
  customer: "👤",
  supplier: "🏭",
  report: "📊",
  zatca: "🧾",
  alert: "⚠️",
  calendar: "📅",
  file: "📎",
  chart: "📈",
  settings: "⚙️",
  link: "🔗",
  menu: "🏠",
  search: "🔍",
  check: "✅",
  cross: "✖️",
  back: "↩️",
  next: "▶️",
  previous: "◀️",
  pdf: "📄",
  excel: "📥",
};

// First Strong Isolate … Pop Directional Isolate. Wrapping a value keeps an invoice number or an
// amount from being reordered when it sits inside Arabic text (docs/BOTS-INTEGRATION-PLAN.md §4.5).
export function isolate(value: string): string {
  return `⁨${value}⁩`;
}

export function truncate(value: string, max: number): string {
  if (max <= 0) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function parseHexColor(hex: string | undefined): number | null {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return Number.parseInt(hex.slice(1), 16);
}

export function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
