-- Parties (a person, company or employee an account can be kept for) and two account
-- extras: the link to a party and a display colour for top-level accounts.
--
-- Expand-only (docs/04 §9: a schema change that cannot be rolled back must not ship): a new
-- table and two nullable columns, nothing existing is altered or dropped. Rollback = drop the
-- two account columns, then the parties table; no data outside them depends on it.

-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "kind" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "parties_kind_check" CHECK ("kind" IN ('COMPANY', 'PERSON', 'EMPLOYEE', 'OTHER'))
);

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "party_id" TEXT,
ADD COLUMN "color" TEXT,
ADD CONSTRAINT "accounts_color_check" CHECK ("color" IS NULL OR "color" ~ '^#[0-9A-Fa-f]{6}$');

-- CreateIndex
CREATE INDEX "parties_company_id_kind_idx" ON "parties"("company_id", "kind");

-- CreateIndex
CREATE INDEX "parties_company_id_name_idx" ON "parties"("company_id", "name");

-- CreateIndex
CREATE INDEX "accounts_company_id_party_id_idx" ON "accounts"("company_id", "party_id");

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A new table is not usable by the restricted runtime role until granted (same pattern as
-- 20260911122010_m3_erp_app_grants). No DELETE: a party is deactivated, never removed, once
-- accounts refer to it. `accounts` already has table-level SELECT/INSERT/UPDATE for erp_app,
-- which covers the two new columns.
GRANT SELECT, INSERT, UPDATE ON "parties" TO erp_app;
