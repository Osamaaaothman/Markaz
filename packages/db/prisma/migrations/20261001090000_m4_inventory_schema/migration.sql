-- M4 Inventory — docs/14-MILESTONES.md. Weighted-average valuation (docs/01-OPEN-DECISIONS.md
-- A3, decided). New tables only: nothing existing is altered, so this is a pure expand and
-- safe to roll back by dropping everything created here, in reverse dependency order.
--
-- CHECK constraints are the database's own backstop for the invariants decided with Osama
-- (docs/05-ACCOUNTING-INTEGRITY-RULES.md §9 principle): no negative stock, a receipt/issue
-- line always has a positive quantity, every amount is non-negative.

-- CreateTable
CREATE TABLE "account_mappings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "account_mappings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_mappings_key_check" CHECK ("key" IN (
        'INVENTORY', 'GRNI', 'PROJECT_ISSUE_EXPENSE', 'COUNT_LOSS', 'COUNT_GAIN'
    ))
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "unit" TEXT NOT NULL,
    "reorder_point" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "items_reorder_point_check" CHECK ("reorder_point" >= 0)
);

-- CreateTable: the weighted-average source of truth per item+warehouse. The CHECKs are the
-- real "no negative stock" guarantee (docs/01-OPEN-DECISIONS.md A3) — the service layer also
-- checks before issuing, but a concurrent-issue race is caught here, not just in application
-- code (docs/05-ACCOUNTING-INTEGRITY-RULES.md §9 principle).
CREATE TABLE "item_warehouse_stock" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "item_warehouse_stock_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "item_warehouse_stock_quantity_check" CHECK ("quantity" >= 0),
    CONSTRAINT "item_warehouse_stock_value_check" CHECK ("value" >= 0)
);

-- CreateTable: append-only (docs/05 §2 principle extended to stock) — no UPDATE/DELETE grant
-- below, same pattern as journal_entry_lines.
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "movement_type" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit_cost" DECIMAL(19,4) NOT NULL,
    "value" DECIMAL(19,4) NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_movements_type_check" CHECK ("movement_type" IN ('RECEIPT', 'ISSUE', 'COUNT_ADJUSTMENT')),
    CONSTRAINT "stock_movements_unit_cost_check" CHECK ("unit_cost" >= 0)
);

-- CreateTable: receipt-based cost layers, written but not yet read for costing (weighted
-- average pools everything into item_warehouse_stock) — exists so a future FIFO tenant
-- setting has real history instead of a schema migration (docs/01-OPEN-DECISIONS.md A3).
CREATE TABLE "cost_layers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "quantity_received" DECIMAL(19,4) NOT NULL,
    "quantity_remaining" DECIMAL(19,4) NOT NULL,
    "unit_cost" DECIMAL(19,4) NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_layers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cost_layers_quantity_received_check" CHECK ("quantity_received" > 0),
    CONSTRAINT "cost_layers_quantity_remaining_check" CHECK ("quantity_remaining" >= 0),
    CONSTRAINT "cost_layers_unit_cost_check" CHECK ("unit_cost" >= 0)
);

-- CreateTable: immutable once created, like a journal entry — a correction is a new document.
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "party_id" TEXT,
    "document_date" DATE NOT NULL,
    "reference" TEXT,
    "journal_entry_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" TEXT NOT NULL,
    "goods_receipt_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit_cost" DECIMAL(19,4) NOT NULL,
    "value" DECIMAL(19,4) NOT NULL,
    "line_number" INTEGER NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "goods_receipt_lines_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "goods_receipt_lines_unit_cost_check" CHECK ("unit_cost" >= 0)
);

-- CreateTable: immutable once created, like a journal entry.
CREATE TABLE "stock_issues" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "cost_center_ref" TEXT NOT NULL,
    "document_date" DATE NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_issue_lines" (
    "id" TEXT NOT NULL,
    "stock_issue_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit_cost" DECIMAL(19,4) NOT NULL,
    "value" DECIMAL(19,4) NOT NULL,
    "line_number" INTEGER NOT NULL,

    CONSTRAINT "stock_issue_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_issue_lines_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "stock_issue_lines_unit_cost_check" CHECK ("unit_cost" >= 0)
);

-- CreateTable: entered as a draft (header + lines, posted_at and each line's journal_entry_id
-- null), then posted as one step — the only M4 document that is not immutable from creation,
-- because the count has to be entered before it can be compared and posted.
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "document_date" DATE NOT NULL,
    "posted_at" TIMESTAMP(3),
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" TEXT NOT NULL,
    "stock_count_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "system_quantity" DECIMAL(19,4) NOT NULL,
    "counted_quantity" DECIMAL(19,4) NOT NULL,
    "unit_cost" DECIMAL(19,4) NOT NULL,
    "journal_entry_id" TEXT,
    "line_number" INTEGER NOT NULL,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_count_lines_system_quantity_check" CHECK ("system_quantity" >= 0),
    CONSTRAINT "stock_count_lines_counted_quantity_check" CHECK ("counted_quantity" >= 0),
    CONSTRAINT "stock_count_lines_unit_cost_check" CHECK ("unit_cost" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "account_mappings_company_id_key_key" ON "account_mappings"("company_id", "key");
CREATE UNIQUE INDEX "warehouses_company_id_code_key" ON "warehouses"("company_id", "code");
CREATE UNIQUE INDEX "warehouses_company_id_ref_key" ON "warehouses"("company_id", "ref");
CREATE UNIQUE INDEX "items_company_id_code_key" ON "items"("company_id", "code");
CREATE UNIQUE INDEX "items_company_id_ref_key" ON "items"("company_id", "ref");
CREATE INDEX "item_warehouse_stock_company_id_idx" ON "item_warehouse_stock"("company_id");
CREATE UNIQUE INDEX "item_warehouse_stock_item_id_warehouse_id_key" ON "item_warehouse_stock"("item_id", "warehouse_id");
CREATE INDEX "stock_movements_company_id_item_id_warehouse_id_idx" ON "stock_movements"("company_id", "item_id", "warehouse_id");
CREATE INDEX "stock_movements_company_id_source_document_type_source_docu_idx" ON "stock_movements"("company_id", "source_document_type", "source_document_id");
CREATE INDEX "cost_layers_company_id_item_id_warehouse_id_idx" ON "cost_layers"("company_id", "item_id", "warehouse_id");
CREATE UNIQUE INDEX "goods_receipts_company_id_number_key" ON "goods_receipts"("company_id", "number");
CREATE INDEX "goods_receipt_lines_goods_receipt_id_idx" ON "goods_receipt_lines"("goods_receipt_id");
CREATE UNIQUE INDEX "stock_issues_company_id_number_key" ON "stock_issues"("company_id", "number");
CREATE INDEX "stock_issue_lines_stock_issue_id_idx" ON "stock_issue_lines"("stock_issue_id");
CREATE UNIQUE INDEX "stock_counts_company_id_number_key" ON "stock_counts"("company_id", "number");
CREATE INDEX "stock_count_lines_stock_count_id_idx" ON "stock_count_lines"("stock_count_id");

-- AddForeignKey
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "items" ADD CONSTRAINT "items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "item_warehouse_stock" ADD CONSTRAINT "item_warehouse_stock_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_warehouse_stock" ADD CONSTRAINT "item_warehouse_stock_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_warehouse_stock" ADD CONSTRAINT "item_warehouse_stock_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cost_layers" ADD CONSTRAINT "cost_layers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_layers" ADD CONSTRAINT "cost_layers_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_layers" ADD CONSTRAINT "cost_layers_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_issue_lines" ADD CONSTRAINT "stock_issue_lines_stock_issue_id_fkey" FOREIGN KEY ("stock_issue_id") REFERENCES "stock_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue_lines" ADD CONSTRAINT "stock_issue_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A new table is not usable by the restricted runtime role until granted (pattern:
-- 20260911122010_m3_erp_app_grants). No DELETE anywhere: master data is deactivated
-- (warehouses, items), movements and posted documents are immutable (append-only, like
-- journal_entries/journal_entry_lines), and account_mappings is re-pointed, not removed.
GRANT SELECT, INSERT, UPDATE ON "account_mappings" TO erp_app;
GRANT SELECT, INSERT, UPDATE ON "warehouses" TO erp_app;
GRANT SELECT, INSERT, UPDATE ON "items" TO erp_app;
GRANT SELECT, INSERT, UPDATE ON "item_warehouse_stock" TO erp_app;

GRANT SELECT, INSERT ON "stock_movements" TO erp_app;
REVOKE UPDATE, DELETE ON "stock_movements" FROM erp_app;
REVOKE UPDATE, DELETE ON "stock_movements" FROM PUBLIC;

GRANT SELECT, INSERT ON "cost_layers" TO erp_app;

GRANT SELECT, INSERT ON "goods_receipts" TO erp_app;
REVOKE UPDATE, DELETE ON "goods_receipts" FROM erp_app;
REVOKE UPDATE, DELETE ON "goods_receipts" FROM PUBLIC;

GRANT SELECT, INSERT ON "goods_receipt_lines" TO erp_app;
REVOKE UPDATE, DELETE ON "goods_receipt_lines" FROM erp_app;
REVOKE UPDATE, DELETE ON "goods_receipt_lines" FROM PUBLIC;

GRANT SELECT, INSERT ON "stock_issues" TO erp_app;
REVOKE UPDATE, DELETE ON "stock_issues" FROM erp_app;
REVOKE UPDATE, DELETE ON "stock_issues" FROM PUBLIC;

GRANT SELECT, INSERT ON "stock_issue_lines" TO erp_app;
REVOKE UPDATE, DELETE ON "stock_issue_lines" FROM erp_app;
REVOKE UPDATE, DELETE ON "stock_issue_lines" FROM PUBLIC;

-- stock_counts/stock_count_lines get UPDATE too: entered as a draft, then posted as a
-- separate step that sets posted_at / each line's journal_entry_id.
GRANT SELECT, INSERT, UPDATE ON "stock_counts" TO erp_app;
GRANT SELECT, INSERT, UPDATE ON "stock_count_lines" TO erp_app;
