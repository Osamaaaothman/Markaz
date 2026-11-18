# Fixed assets module

Built at Osama's request outside official Tier 1 scope (`docs/01-OPEN-DECISIONS.md` C.5).
Plan and rulings: `docs/Planning/fixed-assets-plan.md`.

## What it does

| Capability | Service | Ledger effect |
|---|---|---|
| Categories (accounts, default life, residual %, number prefix) | `AssetCategoryService` | none |
| Draft asset, edit, delete | `FixedAssetService` | none |
| Capitalise a draft (net cost, from any postable account) | `FixedAssetService.capitalize` | Dr asset / Cr source |
| Opening asset with prior depreciation | `FixedAssetService.registerOpening` | Dr asset / Cr accumulated / Cr opening equity |
| Asset bought on a supplier invoice (`kind: "ASSET"` line) | `registerAssetFromSupplierInvoice` (called by purchasing) | inside the invoice entry |
| Transfer (location, custodian, cost center) | `FixedAssetService.transfer` | none |
| Monthly depreciation run, preview, reverse latest | `DepreciationRunService` | Dr expense / Cr accumulated, one pair per asset |
| Disposal (scrap, loss, write-off) | `FixedAssetDisposalService` | final depreciation + Dr accumulated, Dr loss / Cr asset |
| Register as of a date, movement, ledger reconciliation | `FixedAssetReportsService` | read-only |

## Rules that matter

- **Depreciation** (`depreciation.ts`, pure): straight line, pro-rated by the day. Every amount is the
  difference between two cumulative targets, each rounded half-up to the currency minor unit once, so
  the life always ends exactly at the residual value.
- **Runs go forward**: one posted run per month, never before the latest posted run, never for a month
  that has not started. Assets brought in late are caught up in the next run (`isCatchUp`).
- **Reversal** only for the latest run and only while none of its assets has moved since (disposal).
  It posts a mirror entry on the run date, so the run's period must still be open.
- **Locking**: runs and disposals take a per-company advisory lock; asset rows are locked `FOR UPDATE`.
- **Immutability**: once posted, money fields never change; categories with posted assets cannot change
  their accounts or prefix.

## Owned tables

`fixed_asset_categories`, `fixed_assets`, `depreciation_runs`, `depreciation_run_lines` (insert-only),
`fixed_asset_disposals` (insert-only), `fixed_asset_transfers` (insert-only). Adds
`supplier_invoice_lines.fixed_asset_category_id`.

## Dependencies

Core contracts only (`IAccountingEngine`, `INumberingService` via the series table, `IAuditLogger`),
`AccountMappingService` for `FIXED_ASSET_DISPOSAL_LOSS` and `OPENING_BALANCE_EQUITY`.

## Known gaps

- Selling an asset to a customer (needs a ZATCA tax invoice) — ruling D-FA-5, deferred.
- Revaluation, impairment, declining-balance and units-of-production methods.
- Capital additions to an existing asset and changing the remaining life.
- Pausing depreciation; per-unit assets for invoice lines with quantity > 1 (one asset per line today).
- Single currency (the company base currency).
- Tax depreciation separate from book depreciation.
- Manual journal entries on category accounts are not blocked; the reconciliation report shows them.
