# Receipt and payment vouchers

Both voucher forms offer Customer, Supplier, Employee and Account. Customer and supplier
lists include dual-role customer/supplier parties; employees appear only for Employee.
Changing type clears the party, counter-account and invoice allocations. Account offers
active postable accounts; Employee additionally requires the account to belong to that party.

Cash offers only active postable descendants of `CASH_ACCOUNTS_PARENT`. Bank transfer,
cheque, card and other methods offer descendants of `BANK_ACCOUNTS_PARENT`. Nested folders
are supported and inactive branches are excluded. Changing method clears the bank/cash
selection. The server validates the same restrictions on posting, including company scope.

These folders are configurable in Settings > Account mapping. The migration and seed populate
the standard template's cash (`11101`) and bank (`11102`) folders when present. Custom charts
must configure the folders explicitly; missing configuration produces an empty picker with
an explanation. Account names and code prefixes do not decide posting eligibility.

## Posting and allocation

| Voucher | Debit | Credit |
| --- | --- | --- |
| Receipt | Selected bank/cash | Counter-account |
| Payment | Counter-account | Selected bank/cash |

Customers use the configured receivables control account; suppliers use payables, matching
the existing invoice posting rules. Employee and Account vouchers use the selected account.
The selected role and resolved counter-account are stored on the voucher. Employee vouchers
are general account postings: they do not mark payroll runs, salary advances or EOS settlements
as paid. Those workflows retain their dedicated HR actions.

Customer receipts can allocate sales invoices; supplier payments can allocate purchase invoices.
Other combinations post on account without invoice allocations. Customer refunds and supplier
receipts use the appropriate control account and appear on the correct side in statements and
ageing. Refunded money is deducted from the balance available for subsequent invoice settlement.

“Settle now” accepts editable decimal amounts, including Arabic and Persian digits. If the total
amount is blank it is calculated from the allocations. Entering an explicit total supports an
additional on-account balance. Exceeding either the invoice outstanding or the voucher total
blocks posting. Values remain decimal strings throughout.
The editable invoice tables disable PrimeReact cell memoization because allocations are stored
outside `rowData`; otherwise the displayed input retains its old value while totals update.

Reversals mirror the actual original journal lines, preserving the account even if settings have
changed. Original allocations remain recorded and stop affecting outstanding amounts from the
reversal date. A reversal cannot itself be reversed. Only the void marker/link columns are granted
UPDATE permission to the runtime database role; amounts and journal entries remain immutable.

## API and rollout

- Existing create endpoints and permissions remain: `POST /v1/customer-receipts` and
  `POST /v1/supplier-payments`.
- Add `counterpartyKind` (`CUSTOMER`, `SUPPLIER`, `EMPLOYEE`, `ACCOUNT`). Account requires
  `counterAccountId` and omits `partyId`; Employee requires both. Commercial control accounts
  cannot be overridden.
- Legacy callers without a kind retain direction-based roles for historical commercial parties.
- `GET /v1/payments/cash-accounts?method=...` requires `account:read` and returns only eligible
  accounts for the authenticated company.
- Apply `20261115100000_payment_counterparties`, regenerate Prisma, then deploy the API and UI
  together. Existing vouchers remain readable without backfilling their financial data.
- Do not downgrade to a reader that assumes every voucher has a party after Account vouchers
  have been created. No production migration or deployment is part of this local change.

## Verification

- `voucher-types.integration.spec.ts`: PostgreSQL tests for every method and role, both directions,
  exact journal lines, rejected combinations, tenant isolation, refunds, settlement and reversals.
- Existing payments, ageing/statements and dashboard integration suites use configured bank folders.
- Payment DTO tests and party-picker/amount-input unit tests cover filtering and decimal inputs.
- `node apps/web/e2e/payment-vouchers.cjs` uses a Vite preview at port 5179 (override with
  `PAYMENT_PREVIEW_URL`). It exercises Arabic/English receipt/payment forms against explicit HTTP
  fixtures and saves screenshots to `output/payment-vouchers`. These are UI checks, not live postings.

Local results on 2026-11-15: 65 web unit tests, 4 payment DTO tests and all four bilingual browser
journeys passed, including the separate on-account settlement screen. The core run passed 358 of
359 tests; the employee concurrency case exceeded its existing 5-second transaction timeout under
load, then passed in its complete 11-test suite when rerun. All voucher tests passed again after
the final changes. API typecheck, module boundaries and locale parity passed. The web production
build and lint passed in an isolated source copy because unrelated redesign work was being edited
in the shared checkout. Production was not modified.
