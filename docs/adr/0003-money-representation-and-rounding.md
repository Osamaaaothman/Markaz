# ADR-0003: Money representation and rounding policy

## Status
Accepted — 2026-09-10

## Context

`docs/04-DATA-MODEL-RULES.md` §2 mandates a single shared `Money` value object
wrapping a decimal library, one centralised rounding policy, and bans floating point
for any monetary value. This needed a concrete choice: which decimal library, what
rounding mode, and to how many decimal places by default.

This is a technical/representation decision, not an accounting-treatment judgment
call — it does not decide *when* or *how much* to charge, only how a given decimal
amount is stored and rounded once computed. It does not require Osama's accounting
judgment the way a posting rule would (docs/05-ACCOUNTING-INTEGRITY-RULES.md §5).

## Decision

1. **Library: `decimal.js`.** Arbitrary-precision decimal arithmetic, well-established,
   no native build step (pure JS, unlike some BigDecimal alternatives that need
   native bindings — matters for the Alpine-based Docker images).
2. **Storage:** Prisma `Decimal` mapped to Postgres `NUMERIC(19, 4)` for amounts,
   `NUMERIC(19, 6)` for quantities, per docs/04 §2 — applied when the M2 schema adds
   money-bearing columns.
3. **Rounding: half-up to the currency's minor unit**, applied in exactly one place —
   `Money.round()` in `packages/shared/src/money.ts`. No other file in this codebase
   may round a monetary value; UI components display what the server computed.
4. **Minor unit digits come from the `currencies` table at runtime** (added in M2);
   `Money` carries a small built-in fallback registry (SAR/USD/EUR/AED/GBP = 2,
   JPY = 0, KWD/BHD/OMR = 3) for constructing literals in code and tests without a DB
   round-trip.
5. **Money is currency-aware and refuses cross-currency arithmetic** — `add`,
   `subtract`, and `compareTo` throw `CurrencyMismatchError` on a currency mismatch
   rather than silently producing a nonsensical result.
6. **Serialisation is always a decimal string**, never a JS `number` — enforced by
   `Money.toJSON()`.

## Alternatives considered

- **`Prisma.Decimal` directly, no wrapper type.** Rejected: leaks an ORM-specific
  type into domain code and every call site, and provides no currency-mismatch
  protection — arithmetic on two different currencies would silently "work" and
  produce a meaningless number.
- **Banker's rounding (round-half-to-even).** Rejected in favor of half-up: half-up
  is the conventional expectation in Saudi commercial/tax contexts and is simpler to
  explain and audit than round-half-to-even, which most accounting staff would find
  surprising on a specific invoice total.
- **A native BigDecimal binding for extra performance.** Rejected: decimal.js is a
  pure-JS library with no native compile step, which matters directly for the Alpine
  Docker build (`docs/12-OPS-AND-DEPLOYMENT.md` — the same reasoning that led to
  `@node-rs/argon2` over `argon2` for password hashing in M1).

## Consequences

**Gets easier:** every monetary computation in the codebase goes through one type
with one rounding policy — a bug class ("someone rounded in a component, someone
else rounded again in a report") is structurally prevented, not just discouraged by
convention.

**Gets harder:** every place that currently might have reached for a plain `number`
for a quantity or amount must use `Money` instead, including in DTOs and test
fixtures — more verbose than `amount: 10`.

**Will regret at scale (watch for):** the built-in `KNOWN_MINOR_UNITS` fallback
registry is a convenience for code/tests, not the source of truth — if a real
tenant onboarding path is later built without routing every amount construction
through the `currencies` table's authoritative digit count, the fallback could
silently diverge from what a specific tenant actually configured. Revisit when the
`currencies` table (M2) and any tenant-facing currency configuration UI (M9) exist
side by side.

## Still open (not decided here, deliberately)

Line-level vs. document-level rounding for tax calculations (docs/04 §2: "line-level
vs document-level rounding changes the total. Pick one, write it in an ADR, and test
the boundary cases") is a real accounting-flavored question that surfaces properly
once VAT/tax treatment is implemented (M6 Sales, docs/05 §6) — deferred to that ADR,
not decided here. This ADR only covers the `Money` type's own rounding mechanics.
