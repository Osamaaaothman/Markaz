-- The company name in Arabic, printed on Arabic documents and shown in the Arabic interface.
-- Expand-only and nullable: a company without an Arabic name keeps using its registered name everywhere.
ALTER TABLE "companies" ADD COLUMN "name_ar" TEXT;
