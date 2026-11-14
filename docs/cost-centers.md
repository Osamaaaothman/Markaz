# Cost centers for cash expenses

The cash expense list and form expose the cost center directory. Each company has
unique center codes, a name, optional Arabic name, type (cost center, project,
department), and active flag. There is no delete operation: deactivate a center to
stop new allocations while preserving historical links.

API: `GET /v1/cost-centers` requires `cash_expense:read`; `POST` requires
`account:create`; `PUT /v1/cost-centers/:id` requires `account:update`. Writes are
company-scoped and audited transactionally. Duplicate codes return 409.

Cash expense lines accept optional `costCenterId`. The service validates active
company ownership and saves the identifier on both the expense and journal line.
Multiple lines may use the same expense account with different centers. The
accounting engine validates allocations and preserves them on reversals, including
when a center has since been deactivated. Journal details show the linked center.

Apply migration `20261115120000_cost_centers` before deploying the API. This is an
additive migration: old free-text references are retained and are not guessed into
directory entries. Restored old drafts retain their text until a directory center
is selected. No mandatory center policy or cost-center financial report is added.

Verification: cost-center and cash-expense integration specs cover directory scope,
duplicate codes, inactive/foreign allocation rejection, decimal totals, allocation
by line, reversal preservation, and legacy single-line compatibility.

Run API validation and permission metadata checks with
`npm run test:cost-centers --workspace=@erp/api` (ESM is required by Nest 12).
