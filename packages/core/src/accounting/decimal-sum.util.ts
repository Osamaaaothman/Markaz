// Exact decimal-string summation without floating point (docs/04-DATA-MODEL-RULES.md
// §2). NUMERIC(19,4) columns scale by 10^4 and sum as BigInt, which is exact at this
// column's precision. Shared by every report that aggregates journal_entry_lines
// (trial balance, balance sheet, income statement).
export function toScaledBigInt(decimalString: string): bigint {
  const [whole = "0", fraction = ""] = decimalString.split(".");
  const paddedFraction = fraction.padEnd(4, "0").slice(0, 4);
  return BigInt(whole) * 10000n + BigInt(paddedFraction || "0") * (whole.startsWith("-") ? -1n : 1n);
}

export function fromScaledBigInt(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / 10000n;
  const fraction = (abs % 10000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
