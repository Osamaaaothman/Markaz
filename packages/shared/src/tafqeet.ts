import { Money } from "./money.js";

// Spells a money amount out in Arabic words (تفقيط) for printed and on-screen documents —
// e.g. "فقط مائة وخمسة وعشرون ريالاً وخمسون هللة لا غير". Display only: the amount is
// normalised through Money/Decimal first (docs/04-DATA-MODEL-RULES.md §2 — this file never
// does its own rounding), and nothing here ever feeds back into a calculation.

type Gender = "m" | "f";

const ONES: Record<Gender, readonly string[]> = {
  m: ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"],
  f: ["", "إحدى", "اثنتان", "ثلاث", "أربع", "خمس", "ست", "سبع", "ثماني", "تسع"],
};
const TEENS: Record<Gender, readonly string[]> = {
  m: ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"],
  f: ["عشرة", "إحدى عشرة", "اثنتا عشرة", "ثلاث عشرة", "أربع عشرة", "خمس عشرة", "ست عشرة", "سبع عشرة", "ثماني عشرة", "تسع عشرة"],
};
const TENS = ["", "عشرة", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مئتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
const ADJ_ONE: Record<Gender, string> = { m: "واحد", f: "واحدة" };

interface ScaleWords {
  readonly singular: string;
  readonly dual: string;
  readonly plural: string;
}

// Thousand, million, billion, trillion — each one itself a masculine noun being counted,
// same agreement rule as the currency noun (see pickScaleForm / spellAmount below).
const SCALES: readonly ScaleWords[] = [
  { singular: "ألف", dual: "ألفان", plural: "آلاف" },
  { singular: "مليون", dual: "مليونان", plural: "ملايين" },
  { singular: "مليار", dual: "ملياران", plural: "مليارات" },
  { singular: "تريليون", dual: "تريليونان", plural: "تريليونات" },
];

// Spells 1-999. Gender affects only the ones/teens digit; tens and hundreds words don't
// change by gender in Arabic.
function spellGroup(n: number, gender: Gender): string {
  if (n === 0) return "";
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(HUNDREDS[h]!);
  if (rest > 0) {
    if (rest < 10) parts.push(ONES[gender][rest]!);
    else if (rest < 20) parts.push(TEENS[gender][rest - 10]!);
    else {
      const tensDigit = Math.floor(rest / 10);
      const onesDigit = rest % 10;
      if (onesDigit > 0) parts.push(ONES[gender][onesDigit]!);
      parts.push(TENS[tensDigit]!);
    }
  }
  return parts.reduce((acc, p, i) => (i === 0 ? p : `${acc} و${p}`), "");
}

function joinWithWaw(parts: readonly string[]): string {
  return parts.reduce((acc, p, i) => (i === 0 ? p : `${acc} و${p}`), "");
}

// n is the magnitude a scale word (thousand, million, ...) is counting, 1-999.
function pickScaleForm(n: number, scale: ScaleWords): string {
  if (n === 1) return scale.singular;
  if (n === 2) return scale.dual;
  if (n >= 3 && n <= 10) return `${spellGroup(n, "m")} ${scale.plural}`;
  return `${spellGroup(n, "m")} ${scale.singular}`;
}

// Full cardinal spelling of a non-negative integer. `gender` applies to the lowest (units)
// group only — the one immediately next to whatever noun follows the whole number.
function spellInteger(n: number, gender: Gender): string {
  if (n === 0) return "صفر";
  const groups: number[] = [];
  let rest = n;
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  const segments: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (g === 0) continue;
    segments.push(i === 0 ? spellGroup(g, gender) : pickScaleForm(g, SCALES[i - 1]!));
  }
  return joinWithWaw(segments);
}

export interface TafqeetUnitWords {
  readonly singular: string;
  readonly dual: string;
  readonly plural: string;
  readonly gender: Gender;
}

export interface TafqeetCurrencyWords {
  readonly major: TafqeetUnitWords;
  // null for a currency with no minor unit (none of ours today — kept for completeness).
  readonly minor: TafqeetUnitWords | null;
}

export const TAFQEET_CURRENCY_WORDS: Record<string, TafqeetCurrencyWords> = {
  SAR: {
    major: { singular: "ريال", dual: "ريالان", plural: "ريالات", gender: "m" },
    minor: { singular: "هللة", dual: "هللتان", plural: "هللات", gender: "f" },
  },
  USD: {
    major: { singular: "دولار أمريكي", dual: "دولاران أمريكيان", plural: "دولارات أمريكية", gender: "m" },
    minor: { singular: "سنت", dual: "سنتان", plural: "سنتات", gender: "m" },
  },
  EUR: {
    major: { singular: "يورو", dual: "يورو", plural: "يورو", gender: "m" },
    minor: { singular: "سنت", dual: "سنتان", plural: "سنتات", gender: "m" },
  },
  AED: {
    major: { singular: "درهم إماراتي", dual: "درهمان إماراتيان", plural: "دراهم إماراتية", gender: "m" },
    minor: { singular: "فلس", dual: "فلسان", plural: "فلوس", gender: "m" },
  },
  GBP: {
    major: { singular: "جنيه إسترليني", dual: "جنيهان إسترلينيان", plural: "جنيهات إسترلينية", gender: "m" },
    minor: { singular: "بنس", dual: "بنسان", plural: "بنسات", gender: "m" },
  },
  JPY: {
    major: { singular: "ين ياباني", dual: "ينان يابانيان", plural: "ينات يابانية", gender: "m" },
    minor: null,
  },
  KWD: {
    major: { singular: "دينار كويتي", dual: "ديناران كويتيان", plural: "دنانير كويتية", gender: "m" },
    minor: { singular: "فلس", dual: "فلسان", plural: "فلوس", gender: "m" },
  },
  BHD: {
    major: { singular: "دينار بحريني", dual: "ديناران بحرينيان", plural: "دنانير بحرينية", gender: "m" },
    minor: { singular: "فلس", dual: "فلسان", plural: "فلوس", gender: "m" },
  },
  OMR: {
    major: { singular: "ريال عماني", dual: "ريالان عمانيان", plural: "ريالات عمانية", gender: "m" },
    minor: { singular: "بيسة", dual: "بيستان", plural: "بيسات", gender: "f" },
  },
};

// n: how many of this unit there are (riyals, or halalas). Produces the number spelled out
// plus the correctly-agreeing noun — "ريال واحد", "ريالان", "ثلاثة ريالات", "خمسة وعشرون
// ريالاً"...
// REVIEW: a trailing "...01"/"...02" inside a larger number (e.g. 102) is spelled with the
// plain singular noun rather than the more classically precise dropped-number dual form
// ("مائة وريالان" instead of "مائة واثنان ريال") — this matches every commercial Arabic
// number-to-words implementation we could find, but is worth a native-speaker sanity check
// before this ships to a real customer-facing invoice.
function spellAmount(n: number, words: TafqeetUnitWords): string {
  if (n === 1) return `${words.singular} ${ADJ_ONE[words.gender]}`;
  if (n === 2) return words.dual;
  if (n >= 3 && n <= 10) return `${spellGroup(n, words.gender)} ${words.plural}`;
  return `${spellInteger(n, words.gender)} ${words.singular}`;
}

/**
 * Spells a money amount out in Arabic for a printed or on-screen document, e.g.
 * "فقط مائة وخمسة وعشرون ريالاً وخمسون هللة لا غير". Normalises through Money first, so it
 * accepts the same raw amount string/number a caller would pass to formatMoney — it never
 * assumes the input is already rounded to the currency's minor unit.
 */
export function tafqeetAmount(amount: string | number, currency: string): string {
  const words = TAFQEET_CURRENCY_WORDS[currency] ?? TAFQEET_CURRENCY_WORDS.SAR!;
  const normalized = Money.of(amount, currency).round().toDecimalString();
  const [wholeStr, fracStr = ""] = normalized.replace("-", "").split(".");
  const whole = Math.trunc(Number(wholeStr) || 0);
  const fraction = fracStr ? Math.trunc(Number(fracStr) || 0) : 0;

  const majorWords = spellAmount(whole, words.major);
  if (!words.minor || fraction === 0) {
    return `فقط ${majorWords} لا غير`;
  }
  const minorWords = spellAmount(fraction, words.minor);
  return `فقط ${majorWords} و${minorWords} لا غير`;
}
