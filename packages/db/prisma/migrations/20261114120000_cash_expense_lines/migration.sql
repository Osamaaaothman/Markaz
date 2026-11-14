-- CreateTable
CREATE TABLE "cash_expense_lines" (
    "id" TEXT NOT NULL,
    "cash_expense_id" TEXT NOT NULL,
    "expense_account_id" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "cost_center_ref" TEXT,
    "description" TEXT,
    CONSTRAINT "cash_expense_lines_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "cash_expense_lines_cash_expense_id_idx" ON "cash_expense_lines"("cash_expense_id");
-- Posted expense detail is insert-only, matching the existing header permissions.
GRANT SELECT, INSERT ON "cash_expense_lines" TO erp_app;
-- AddForeignKey
ALTER TABLE "cash_expense_lines" ADD CONSTRAINT "cash_expense_lines_cash_expense_id_fkey" FOREIGN KEY ("cash_expense_id") REFERENCES "cash_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cash_expense_lines" ADD CONSTRAINT "cash_expense_lines_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- MigrateData: preserve existing single-line data
INSERT INTO "cash_expense_lines" ("id", "cash_expense_id", "expense_account_id", "amount")
SELECT gen_random_uuid()::text, "id", "expense_account_id", "amount"
FROM "cash_expenses";
-- Expand only: keep the old account and FK while older API instances are running.
-- Multi-account documents cannot be represented by one legacy account.
ALTER TABLE "cash_expenses" ALTER COLUMN "expense_account_id" DROP NOT NULL;

-- Old API instances can still insert a single-line header after the backfill.
-- Defer until commit so the new API's explicit lines win and are never duplicated.
CREATE FUNCTION sync_legacy_cash_expense_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expense_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM cash_expense_lines WHERE cash_expense_id = NEW.id
  ) THEN
    INSERT INTO cash_expense_lines (id, cash_expense_id, expense_account_id, amount)
    VALUES (gen_random_uuid()::text, NEW.id, NEW.expense_account_id, NEW.amount);
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER cash_expense_legacy_line
AFTER INSERT ON cash_expenses DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION sync_legacy_cash_expense_line();
