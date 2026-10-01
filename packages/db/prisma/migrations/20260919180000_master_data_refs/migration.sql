-- Human-readable references (USR-000012, ROL-000003, PRT-000041, ACC-000217) on master data.
--
-- The UUID primary keys stay exactly as they are (docs/04-DATA-MODEL-RULES.md §1); `ref` is an
-- extra, per-company, never-reused label people can read out, search and copy. Numbers come from
-- `document_number_series` (document type REF_<PREFIX>, fiscal year 'ALL' because master data does
-- not restart every year), the same gapless table INumberingService uses.
--
-- Additive: existing rows are backfilled oldest-first per company, and the series rows are
-- seeded so the next allocation continues after the backfill. Rollback = drop the four `ref`
-- columns and delete the REF_* series rows.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "ref" TEXT;
ALTER TABLE "roles" ADD COLUMN "ref" TEXT;
ALTER TABLE "parties" ADD COLUMN "ref" TEXT;
ALTER TABLE "accounts" ADD COLUMN "ref" TEXT;

-- Backfill, oldest first within each company.
UPDATE "users" AS t SET "ref" = 'USR-' || LPAD(n.rn::text, 6, '0')
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "company_id" ORDER BY "created_at", "id") AS rn FROM "users") AS n
WHERE t."id" = n."id";

UPDATE "roles" AS t SET "ref" = 'ROL-' || LPAD(n.rn::text, 6, '0')
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "company_id" ORDER BY "created_at", "id") AS rn FROM "roles") AS n
WHERE t."id" = n."id";

UPDATE "parties" AS t SET "ref" = 'PRT-' || LPAD(n.rn::text, 6, '0')
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "company_id" ORDER BY "created_at", "id") AS rn FROM "parties") AS n
WHERE t."id" = n."id";

UPDATE "accounts" AS t SET "ref" = 'ACC-' || LPAD(n.rn::text, 6, '0')
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "company_id" ORDER BY "created_at", "id") AS rn FROM "accounts") AS n
WHERE t."id" = n."id";

-- Continue numbering after the backfill.
INSERT INTO "document_number_series" ("id", "company_id", "document_type", "fiscal_year", "prefix", "padding", "last_number", "updated_at")
SELECT gen_random_uuid()::text, "company_id", 'REF_USR', 'ALL', 'USR-', 6, COUNT(*), now() FROM "users" GROUP BY "company_id"
ON CONFLICT ("company_id", "document_type", "fiscal_year") DO NOTHING;

INSERT INTO "document_number_series" ("id", "company_id", "document_type", "fiscal_year", "prefix", "padding", "last_number", "updated_at")
SELECT gen_random_uuid()::text, "company_id", 'REF_ROL', 'ALL', 'ROL-', 6, COUNT(*), now() FROM "roles" GROUP BY "company_id"
ON CONFLICT ("company_id", "document_type", "fiscal_year") DO NOTHING;

INSERT INTO "document_number_series" ("id", "company_id", "document_type", "fiscal_year", "prefix", "padding", "last_number", "updated_at")
SELECT gen_random_uuid()::text, "company_id", 'REF_PRT', 'ALL', 'PRT-', 6, COUNT(*), now() FROM "parties" GROUP BY "company_id"
ON CONFLICT ("company_id", "document_type", "fiscal_year") DO NOTHING;

INSERT INTO "document_number_series" ("id", "company_id", "document_type", "fiscal_year", "prefix", "padding", "last_number", "updated_at")
SELECT gen_random_uuid()::text, "company_id", 'REF_ACC', 'ALL', 'ACC-', 6, COUNT(*), now() FROM "accounts" GROUP BY "company_id"
ON CONFLICT ("company_id", "document_type", "fiscal_year") DO NOTHING;

-- Every row has one now: make it required and unique per company.
ALTER TABLE "users" ALTER COLUMN "ref" SET NOT NULL;
ALTER TABLE "roles" ALTER COLUMN "ref" SET NOT NULL;
ALTER TABLE "parties" ALTER COLUMN "ref" SET NOT NULL;
ALTER TABLE "accounts" ALTER COLUMN "ref" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_company_id_ref_key" ON "users"("company_id", "ref");
CREATE UNIQUE INDEX "roles_company_id_ref_key" ON "roles"("company_id", "ref");
CREATE UNIQUE INDEX "parties_company_id_ref_key" ON "parties"("company_id", "ref");
CREATE UNIQUE INDEX "accounts_company_id_ref_key" ON "accounts"("company_id", "ref");
