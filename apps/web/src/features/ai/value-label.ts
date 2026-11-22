import type { i18n as I18n } from "i18next";

// System codes (CASH, PENDING_APPROVAL, SUPPLIER, ASSET, yes/no, units...) arrive from the server as
// raw values. Shown to people they must be words in the user's language: a code with an
// `ai.enum.<CODE>` translation is replaced by it; anything else (names, numbers) is shown as is.
export function valueLabel(i18n: I18n, value: string): string {
  if (value.startsWith("ai.")) return i18n.t(value);
  const key = `ai.enum.${value}`;
  return /^[A-Za-z_]{2,40}$/.test(value) && i18n.exists(key) ? i18n.t(key) : value;
}
