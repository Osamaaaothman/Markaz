import { Money } from "@erp/shared";

// docs/08-FRONTEND-I18N-RULES.md §6: "Amounts arrive as strings; parse with the
// shared decimal library... Show the currency code explicitly." This is the one
// place the frontend formats an amount for display — never inline `.toFixed()`
// or string concatenation elsewhere.
export function formatMoney(amount: string, currency: string): string {
  return `${Money.of(amount, currency).toDecimalString()} ${currency}`;
}
