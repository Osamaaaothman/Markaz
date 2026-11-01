-- M10: Performance — add composite index on (company_id, entry_date) for
-- date-range queries in income statement, cash flow, and trial balance reports.
-- Without this, a full table scan runs for every report on large datasets.
CREATE INDEX "journal_entries_company_id_entry_date_idx"
  ON "journal_entries"("company_id", "entry_date");
