-- Fixed assets module (docs/Planning/fixed-assets-plan.md).

ALTER TABLE "supplier_invoice_lines" ADD COLUMN     "fixed_asset_category_id" TEXT;

CREATE TABLE "fixed_asset_categories" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "number_prefix" TEXT NOT NULL,
    "depreciation_method" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
    "is_depreciable" BOOLEAN NOT NULL DEFAULT true,
    "default_useful_life_months" INTEGER,
    "default_residual_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "asset_account_id" TEXT NOT NULL,
    "accumulated_depreciation_account_id" TEXT,
    "depreciation_expense_account_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "description" TEXT,
    "category_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "acquisition_date" DATE NOT NULL,
    "in_service_date" DATE NOT NULL,
    "acquisition_cost" DECIMAL(19,4) NOT NULL,
    "residual_value" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "useful_life_months" INTEGER,
    "depreciation_method" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
    "opening_accumulated_depreciation" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "opening_as_of_date" DATE,
    "accumulated_depreciation" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "depreciated_through" DATE,
    "currency" TEXT NOT NULL,
    "supplier_party_id" TEXT,
    "custodian_employee_id" TEXT,
    "cost_center_id" TEXT,
    "location" TEXT,
    "serial_number" TEXT,
    "barcode" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'MANUAL',
    "source_account_id" TEXT,
    "supplier_invoice_line_id" TEXT,
    "capitalization_journal_entry_id" TEXT,
    "capitalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "depreciation_runs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "run_date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "total_amount" DECIMAL(19,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "journal_entry_id" TEXT NOT NULL,
    "reversal_journal_entry_id" TEXT,
    "reversal_reason" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depreciation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "depreciation_run_lines" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "previous_depreciated_through" DATE,
    "previous_status" TEXT NOT NULL,
    "accumulated_after" DECIMAL(19,4) NOT NULL,
    "net_book_value_after" DECIMAL(19,4) NOT NULL,
    "cost_center_id" TEXT,
    "is_catch_up" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "depreciation_run_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fixed_asset_disposals" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "disposal_date" DATE NOT NULL,
    "disposal_type" TEXT NOT NULL,
    "cost_at_disposal" DECIMAL(19,4) NOT NULL,
    "accumulated_at_disposal" DECIMAL(19,4) NOT NULL,
    "final_depreciation_amount" DECIMAL(19,4) NOT NULL,
    "final_depreciation_days" INTEGER NOT NULL,
    "gain_loss" DECIMAL(19,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_asset_disposals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fixed_asset_transfers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "transfer_date" DATE NOT NULL,
    "from_location" TEXT,
    "to_location" TEXT,
    "from_custodian_employee_id" TEXT,
    "to_custodian_employee_id" TEXT,
    "from_cost_center_id" TEXT,
    "to_cost_center_id" TEXT,
    "reason" TEXT,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_asset_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fixed_asset_categories_company_id_code_key" ON "fixed_asset_categories"("company_id", "code");

CREATE UNIQUE INDEX "fixed_asset_categories_company_id_number_prefix_key" ON "fixed_asset_categories"("company_id", "number_prefix");

CREATE UNIQUE INDEX "fixed_assets_supplier_invoice_line_id_key" ON "fixed_assets"("supplier_invoice_line_id");

CREATE INDEX "fixed_assets_company_id_status_idx" ON "fixed_assets"("company_id", "status");

CREATE INDEX "fixed_assets_company_id_category_id_idx" ON "fixed_assets"("company_id", "category_id");

CREATE INDEX "fixed_assets_company_id_custodian_employee_id_idx" ON "fixed_assets"("company_id", "custodian_employee_id");

CREATE UNIQUE INDEX "fixed_assets_company_id_number_key" ON "fixed_assets"("company_id", "number");

CREATE INDEX "depreciation_runs_company_id_period_year_period_month_idx" ON "depreciation_runs"("company_id", "period_year", "period_month");

CREATE UNIQUE INDEX "depreciation_runs_company_id_number_key" ON "depreciation_runs"("company_id", "number");

CREATE INDEX "depreciation_run_lines_run_id_idx" ON "depreciation_run_lines"("run_id");

CREATE INDEX "depreciation_run_lines_asset_id_idx" ON "depreciation_run_lines"("asset_id");

CREATE UNIQUE INDEX "fixed_asset_disposals_asset_id_key" ON "fixed_asset_disposals"("asset_id");

CREATE UNIQUE INDEX "fixed_asset_disposals_company_id_number_key" ON "fixed_asset_disposals"("company_id", "number");

CREATE INDEX "fixed_asset_transfers_asset_id_idx" ON "fixed_asset_transfers"("asset_id");

ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_fixed_asset_category_id_fkey" FOREIGN KEY ("fixed_asset_category_id") REFERENCES "fixed_asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_asset_account_id_fkey" FOREIGN KEY ("asset_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_accumulated_depreciation_account_id_fkey" FOREIGN KEY ("accumulated_depreciation_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_depreciation_expense_account_id_fkey" FOREIGN KEY ("depreciation_expense_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fixed_asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_supplier_party_id_fkey" FOREIGN KEY ("supplier_party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_custodian_employee_id_fkey" FOREIGN KEY ("custodian_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_supplier_invoice_line_id_fkey" FOREIGN KEY ("supplier_invoice_line_id") REFERENCES "supplier_invoice_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_capitalization_journal_entry_id_fkey" FOREIGN KEY ("capitalization_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_reversal_journal_entry_id_fkey" FOREIGN KEY ("reversal_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "depreciation_run_lines" ADD CONSTRAINT "depreciation_run_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "depreciation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "depreciation_run_lines" ADD CONSTRAINT "depreciation_run_lines_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "depreciation_run_lines" ADD CONSTRAINT "depreciation_run_lines_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_asset_disposals" ADD CONSTRAINT "fixed_asset_disposals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_asset_disposals" ADD CONSTRAINT "fixed_asset_disposals_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_asset_disposals" ADD CONSTRAINT "fixed_asset_disposals_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_asset_transfers" ADD CONSTRAINT "fixed_asset_transfers_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integrity rules the database enforces itself (docs/04 §, docs/05 §1) ──────────────────────
ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_method_check"
  CHECK ("depreciation_method" IN ('STRAIGHT_LINE'));
ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_depreciable_check"
  CHECK (
    "is_depreciable" = false
    OR ("accumulated_depreciation_account_id" IS NOT NULL AND "depreciation_expense_account_id" IS NOT NULL)
  );
ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_life_check"
  CHECK ("default_useful_life_months" IS NULL OR "default_useful_life_months" BETWEEN 1 AND 1200);
ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_residual_check"
  CHECK ("default_residual_percent" >= 0 AND "default_residual_percent" < 100);

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_status_check"
  CHECK ("status" IN ('DRAFT', 'ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED'));
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_source_check"
  CHECK ("source_type" IN ('MANUAL', 'OPENING', 'SUPPLIER_INVOICE'));
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_amounts_check"
  CHECK (
    "acquisition_cost" > 0
    AND "residual_value" >= 0
    AND "residual_value" <= "acquisition_cost"
    AND "opening_accumulated_depreciation" >= 0
    AND "accumulated_depreciation" >= 0
    AND "accumulated_depreciation" <= "acquisition_cost" - "residual_value"
  );
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_life_check"
  CHECK ("useful_life_months" IS NULL OR "useful_life_months" BETWEEN 1 AND 1200);
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_dates_check"
  CHECK ("in_service_date" >= "acquisition_date");
-- A posted asset always carries the entry that put its cost in the ledger.
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_posted_entry_check"
  CHECK ("status" = 'DRAFT' OR "capitalization_journal_entry_id" IS NOT NULL);

ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_status_check"
  CHECK ("status" IN ('POSTED', 'REVERSED'));
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_month_check"
  CHECK ("period_month" BETWEEN 1 AND 12 AND "total_amount" > 0);
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_reversal_check"
  CHECK (("status" = 'POSTED') = ("reversal_journal_entry_id" IS NULL));
-- At most one live run per month; a reversed run frees the month for a new one.
CREATE UNIQUE INDEX "depreciation_runs_one_posted_per_month"
  ON "depreciation_runs" ("company_id", "period_year", "period_month") WHERE "status" = 'POSTED';

ALTER TABLE "depreciation_run_lines" ADD CONSTRAINT "depreciation_run_lines_amounts_check"
  CHECK ("amount" > 0 AND "days" > 0 AND "to_date" >= "from_date" AND "net_book_value_after" >= 0);

ALTER TABLE "fixed_asset_disposals" ADD CONSTRAINT "fixed_asset_disposals_type_check"
  CHECK ("disposal_type" IN ('SCRAP', 'LOSS', 'WRITE_OFF'));
ALTER TABLE "fixed_asset_disposals" ADD CONSTRAINT "fixed_asset_disposals_amounts_check"
  CHECK ("cost_at_disposal" > 0 AND "accumulated_at_disposal" >= 0 AND "final_depreciation_amount" >= 0 AND "final_depreciation_days" >= 0);

-- An ASSET line on a supplier invoice debits its category's asset account (kept in account_id).
ALTER TABLE "supplier_invoice_lines" DROP CONSTRAINT "supplier_invoice_lines_kind_check";
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_kind_check"
  CHECK (
    ("kind" = 'PO_LINE' AND "purchase_order_line_id" IS NOT NULL AND "account_id" IS NULL AND "fixed_asset_category_id" IS NULL)
    OR ("kind" = 'EXPENSE' AND "account_id" IS NOT NULL AND "purchase_order_line_id" IS NULL AND "fixed_asset_category_id" IS NULL)
    OR ("kind" = 'ASSET' AND "account_id" IS NOT NULL AND "fixed_asset_category_id" IS NOT NULL AND "purchase_order_line_id" IS NULL)
  );

-- ── Grants for the runtime role ──────────────────────────────────────────────────────────────
-- Categories and the register are master data (deactivate, never delete, except a DRAFT asset).
GRANT SELECT, INSERT, UPDATE ON "fixed_asset_categories" TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "fixed_assets" TO erp_app;
-- A run is posted once; only its reversal fields are ever filled in afterwards.
GRANT SELECT, INSERT, UPDATE ON "depreciation_runs" TO erp_app;
GRANT SELECT, INSERT ON "depreciation_run_lines" TO erp_app;
GRANT SELECT, INSERT ON "fixed_asset_disposals" TO erp_app;
GRANT SELECT, INSERT ON "fixed_asset_transfers" TO erp_app;

-- ── Permissions (same catalog as seed.ts) ───────────────────────────────────────────────────
INSERT INTO "permissions" ("id", "code", "description")
VALUES
  (gen_random_uuid()::text, 'fixed_asset:read', 'View the fixed asset register, schedules and reports'),
  (gen_random_uuid()::text, 'fixed_asset:create', 'Create and edit draft fixed assets'),
  (gen_random_uuid()::text, 'fixed_asset:update', 'Edit an asset''s non-financial details and transfer it'),
  (gen_random_uuid()::text, 'fixed_asset:capitalize', 'Post a fixed asset to the ledger (capitalise or register an opening asset)'),
  (gen_random_uuid()::text, 'fixed_asset:dispose', 'Dispose of (scrap or write off) a fixed asset'),
  (gen_random_uuid()::text, 'fixed_asset_category:read', 'View fixed asset categories'),
  (gen_random_uuid()::text, 'fixed_asset_category:manage', 'Create and edit fixed asset categories'),
  (gen_random_uuid()::text, 'depreciation_run:read', 'View depreciation runs'),
  (gen_random_uuid()::text, 'depreciation_run:post', 'Post a monthly depreciation run'),
  (gen_random_uuid()::text, 'depreciation_run:reverse', 'Reverse the latest depreciation run')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" IN ('Admin', 'Accountant')
  AND p."code" IN (
    'fixed_asset:read', 'fixed_asset:create', 'fixed_asset:update', 'fixed_asset:capitalize', 'fixed_asset:dispose',
    'fixed_asset_category:read', 'fixed_asset_category:manage',
    'depreciation_run:read', 'depreciation_run:post', 'depreciation_run:reverse'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
