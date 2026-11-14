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
-- AddForeignKey
ALTER TABLE "cash_expense_lines" ADD CONSTRAINT "cash_expense_lines_cash_expense_id_fkey" FOREIGN KEY ("cash_expense_id") REFERENCES "cash_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cash_expense_lines" ADD CONSTRAINT "cash_expense_lines_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- MigrateData: preserve existing single-line data
INSERT INTO "cash_expense_lines" ("id", "cash_expense_id", "expense_account_id", "amount")
SELECT gen_random_uuid()::text, "id", "expense_account_id", "amount"
FROM "cash_expenses";
-- DropForeignKey (find actual constraint name from schema; may vary)
ALTER TABLE "cash_expenses" DROP CONSTRAINT IF EXISTS "cash_expenses_expense_account_id_fkey";
-- AlterTable
ALTER TABLE "cash_expenses" DROP COLUMN "expense_account_id";
