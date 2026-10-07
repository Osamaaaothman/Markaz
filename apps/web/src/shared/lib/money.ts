import { Money } from "@erp/shared";

// docs/08-FRONTEND-I18N-RULES.md §6: "Amounts arrive as strings; parse with the
// shared decimal library... Show the currency code explicitly." This is the one
// place the frontend formats an amount for display — never inline `.toFixed()`
// or string concatenation elsewhere.
export function formatMoney(amount: string, currency: string): string {
  return `${groupThousands(Money.of(amount, currency).toDecimalString())} ${currency}`;
}

// 1234567.50 -> 1,234,567.50. Done on the decimal STRING (never a JS number), so no digit can change, and
// with plain commas so the figure reads the same in both languages and in a spreadsheet paste.
export function groupThousands(decimal: string): string {
  const negative = decimal.startsWith("-");
  const [whole = "", fraction] = (negative ? decimal.slice(1) : decimal).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction !== undefined ? `.${fraction}` : ""}`;
}
