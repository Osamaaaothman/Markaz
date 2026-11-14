// Keep money as decimal strings, including while typing. Accept both Arabic digit sets.
export function normalizePaymentAmount(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0))
    .replace(/٫/g, ".").replace(/٬/g, "").trim();
}
