import { Decimal } from "decimal.js";

// docs/04-DATA-MODEL-RULES.md §2: "Floating point is banned for any monetary or
// quantity value." This is the ONLY place Money arithmetic and rounding happen —
// never round in a UI component, never round twice, never use a JS number.

// Fallback registry used only when constructing a Money literal without a DB
// round-trip (e.g. in code or tests). The `currencies` table (M2 schema) is the
// runtime source of truth once a tenant's currency list exists.
const KNOWN_MINOR_UNITS: Record<string, number> = {
  SAR: 2,
  USD: 2,
  EUR: 2,
  AED: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
};

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Cannot operate on Money with different currencies: ${a} vs ${b}`);
    this.name = "CurrencyMismatchError";
  }
}

export class Money {
  private readonly value: Decimal;
  readonly currency: string;

  private constructor(value: Decimal, currency: string) {
    this.value = value;
    this.currency = currency;
  }

  static of(amount: string | number, currency: string): Money {
    return new Money(new Decimal(amount), currency);
  }

  static zero(currency: string): Money {
    return new Money(new Decimal(0), currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  // Scaling by a plain number (a tax rate, a quantity) is meaningful; multiplying
  // two Money values together is not, and is deliberately not provided.
  multiply(factor: string | number): Money {
    return new Money(this.value.times(factor), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  compareTo(other: Money): number {
    this.assertSameCurrency(other);
    return this.value.comparedTo(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  /**
   * Rounds to the currency's minor unit — half-up, the single centralised rounding
   * policy for this system (docs/04-DATA-MODEL-RULES.md §2; rationale recorded in
   * docs/adr/0003-money-representation-and-rounding.md). Pass minorUnitDigits
   * explicitly when the caller already has the authoritative value from the
   * `currencies` table; falls back to the built-in registry otherwise.
   */
  round(minorUnitDigits?: number): Money {
    const digits = minorUnitDigits ?? KNOWN_MINOR_UNITS[this.currency] ?? 2;
    return new Money(this.value.toDecimalPlaces(digits, Decimal.ROUND_HALF_UP), this.currency);
  }

  /**
   * Renders as a fixed-decimal string. Defaults to the currency's minor unit digit
   * count (so a SAR amount always shows "10.00", never "10" — decimal.js itself has
   * no notion of "trailing zero precision", so this must be explicit). Pass an
   * explicit digit count for values that intentionally carry more precision than
   * the currency's minor unit (e.g. a per-unit price stored to 4 decimal places —
   * docs/04-DATA-MODEL-RULES.md §2: "decide per column, document it").
   */
  toDecimalString(minorUnitDigits?: number): string {
    const digits = minorUnitDigits ?? KNOWN_MINOR_UNITS[this.currency] ?? 2;
    return this.value.toFixed(digits);
  }

  // Amounts cross the API as strings, never JS numbers — docs/04 §2.
  toJSON(): string {
    return this.toDecimalString();
  }
}
