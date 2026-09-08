# 10 — Testing Rules

Osama is not hand-writing this code, and he will support it for years. **Tests are the
only mechanism that will catch a regression before a customer's ledger does.**

---

## 1. The test pyramid for this system

| Layer | What | Speed |
|---|---|---|
| Domain unit tests | Invariants, money arithmetic, posting rules, valuation, tax, numbering | ms |
| Service/integration tests | Use cases against a real Postgres (Testcontainers) | seconds |
| API tests | Endpoint contract, auth, validation, errors | seconds |
| Tenant isolation suite | Cross-tenant access, per endpoint | seconds |
| Compliance tests | Golden-file XML, QR TLV, failure modes, mocked ZATCA | seconds |
| E2E | Critical journeys through the UI (Playwright), AR and EN | minutes |

**Use a real PostgreSQL in integration tests, not SQLite or a mock.** Constraints,
triggers, transaction behaviour, `NUMERIC` semantics, and RLS/search-path are precisely
what you are testing. A mocked database proves nothing here.

---

## 2. Non-negotiable test suites

These exist from the milestone that introduces them, and run in CI on every push.

### 2.1 Ledger integrity
- Every generated journal entry balances, in transaction currency and base currency
- **Property-based test:** generate random sequences of valid business operations
  (purchase, receipt, sale, payment, adjustment, reversal) and assert the trial balance
  is exactly zero after each. This one test is worth more than a hundred unit tests.
- Sub-ledger to control-account reconciliation (AR, inventory)
- Posting into a closed period is rejected — by the database, tested directly
- A posted entry cannot be updated or deleted — tested by attempting it
- Reversal produces the exact expected mirrored entry

### 2.2 Money
- No float anywhere: a lint rule or a test that fails if a monetary field is typed as a
  number
- Rounding boundary cases: `.005`, `.015`, `.025`, negative amounts, very large amounts
- Multi-currency: conversion, stored rate immutability, exchange gain/loss
- Long chains of operations still tie out to the cent
- API serialisation: amounts are strings in and out

### 2.3 Tenant isolation
See `docs/03-MULTI-TENANCY-RULES.md` §4. Every read endpoint is covered; adding an
endpoint means adding it to this suite. Not optional.

### 2.4 Compliance
- Golden-file XML tests (byte-exact for fixed input)
- QR TLV against known vectors
- Hash chain continuity, including across a rejection
- Failure modes: timeout · 5xx · rejection · malformed response · accepted-with-warnings
- Outbox guarantees: a crash between commit and submission still results in submission
- Idempotency: the same invoice is never submitted twice
- No key material in logs

### 2.5 Concurrency
- Two concurrent updates to a document → one succeeds, one gets `409`
- Two concurrent requests for a document number → two different gapless numbers
- Two concurrent stock issues against the last unit → one fails cleanly
- Idempotency key replay → original result, no double post, no number consumed

### 2.6 i18n / RTL
- Locale key parity: every key exists in both `ar` and `en` — CI fails otherwise
- No hard-coded user-facing string: lint rule
- E2E critical journeys run in both locales
- Visual check of key screens in both directions

---

## 3. Test quality standards

- **Never weaken or delete a test to make it pass.** Fix the cause.
- **Never write a test that cannot fail.** If commenting out the implementation leaves
  it green, it is not a test. Verify this deliberately for the important ones.
- Names describe behaviour: `rejects_posting_into_a_closed_fiscal_period`, not `test3`.
- Arrange / Act / Assert, visibly separated.
- Deterministic: no sleeps, no wall-clock dependence (inject the clock), no shared
  mutable state between tests, no ordering dependence.
- A flaky test is a broken test. Fix it or delete it — never retry-loop it.
- Test data via **builders/factories**, not 200-line literal fixtures.
- **Never test against a real ZATCA production environment.** Sandbox or mock only.

---

## 4. Coverage

Coverage is a signal, not a target. But:
- `domain/` and posting logic: near-full coverage — pure, cheap, and the highest-risk
  code in the system
- Every use case: happy path + at least one failure path
- Do not chase coverage on framework glue with meaningless assertions

Report measured numbers. Never claim a number you have not measured.

---

## 5. Seeded environments

- **Demo tenant** — realistic, bilingual, for development and sales demos
- **Performance fixture** — e.g. 3 fiscal years, 200k journal lines, 50k invoices;
  reports are benchmarked against this before being called done
- **Edge-case tenant** — multi-currency, multi-branch, closed prior periods, reversed
  entries, mixed tax treatments
- Seeds are code, versioned, reproducible, and contain **no real customer data**

---

## 6. CI

Every push: lint → typecheck → build → unit → integration → API → isolation →
i18n parity → dependency audit. Nightly: E2E + performance.

CI must be fast enough that it is actually run. If it becomes slow, parallelise it —
do not start skipping it.

---

## 7. Definition of done

```
[ ] Lint + typecheck clean, zero warnings, no `any`, no unexplained `@ts-ignore`
[ ] Unit tests for new domain logic
[ ] Integration test for the main flow, against real Postgres
[ ] Tenant isolation test added for any new endpoint
[ ] Ledger integrity suite still green
[ ] Both AR and EN translations present; screen verified in RTL and LTR
[ ] Permissions checked and audit records written
[ ] Money handled via the shared type; no floats
[ ] Migration reviewed, expand/contract safe, tested against seeded data
[ ] OpenAPI updated; frontend types regenerated
[ ] Module README and ADR updated
[ ] Ownership package delivered (CLAUDE.md §5)
```

---

## 8. Honesty

Never report a test as passing without having executed it. If you have not run it, say
"written but not yet executed." If output is truncated, say so. A fabricated green
result in a financial system is the most damaging thing you can produce.
