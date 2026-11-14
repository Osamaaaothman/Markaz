import { Money } from "./money.js";

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion"];
type Units = readonly [singular: string, plural: string];
const CURRENCIES: Readonly<Record<string, { major: Units; minor: Units | null }>> = {
  SAR: { major: ["Saudi riyal", "Saudi riyals"], minor: ["halala", "halalas"] },
  AED: { major: ["UAE dirham", "UAE dirhams"], minor: ["fil", "fils"] },
  USD: { major: ["US dollar", "US dollars"], minor: ["cent", "cents"] },
  EUR: { major: ["euro", "euros"], minor: ["cent", "cents"] },
  GBP: { major: ["pound sterling", "pounds sterling"], minor: ["penny", "pence"] },
  JPY: { major: ["Japanese yen", "Japanese yen"], minor: null },
  KWD: { major: ["Kuwaiti dinar", "Kuwaiti dinars"], minor: ["fil", "fils"] },
  BHD: { major: ["Bahraini dinar", "Bahraini dinars"], minor: ["fil", "fils"] },
  OMR: { major: ["Omani rial", "Omani rials"], minor: ["baisa", "baisa"] },
};

function groupWords(value: number): string {
  if (value < 20) return ONES[value]!;
  if (value < 100) return `${TENS[Math.floor(value / 10)]}${value % 10 ? `-${ONES[value % 10]}` : ""}`;
  return `${ONES[Math.floor(value / 100)]} hundred${value % 100 ? ` and ${groupWords(value % 100)}` : ""}`;
}

function integerWords(value: bigint): string {
  if (value === 0n) return "zero";
  const groups: string[] = [];
  let remaining = value;
  let scale = 0;
  while (remaining > 0n) {
    const part = Number(remaining % 1000n); // At most three digits; the amount itself stays exact.
    if (SCALES[scale] === undefined) throw new RangeError("Amount exceeds supported number-word scale");
    if (part) groups.unshift(`${groupWords(part)}${scale ? ` ${SCALES[scale]}` : ""}`);
    remaining /= 1000n;
    scale++;
  }
  return groups.join(" ");
}

/** Display only. Use the same currency precision and rounding as the printed amount. */
export function amountInEnglishWords(amount: string | number, currency: string): string {
  const normalized = Money.of(amount, currency).round().toDecimalString();
  const negative = normalized.startsWith("-");
  const [whole = "0", fraction = "0"] = normalized.replace(/^-/, "").split(".");
  const major = BigInt(whole);
  const minor = BigInt(fraction);
  const words = CURRENCIES[currency] ?? { major: [currency, currency] as const, minor: ["minor unit", "minor units"] as const };
  const main = `${integerWords(major)} ${words.major[major === 1n ? 0 : 1]}`;
  const fractional = minor && words.minor ? ` and ${integerWords(minor)} ${words.minor[minor === 1n ? 0 : 1]}` : "";
  const result = `${negative && (major || minor) ? "minus " : ""}${main}${fractional} only`;
  return result.charAt(0).toUpperCase() + result.slice(1);
}
