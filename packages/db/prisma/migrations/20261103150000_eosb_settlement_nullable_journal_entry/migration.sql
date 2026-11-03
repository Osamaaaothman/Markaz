-- An end-of-service settlement with nothing owed (e.g. a resignation under two years) is recorded
-- but posts no journal entry: there is no ledger event, and the posting engine rightly refuses
-- zero-amount lines. So the entry reference becomes optional -- but only when nothing is owed.
-- Expand-only: relaxes a constraint and adds a CHECK that every existing row already satisfies
-- (until now every settlement row has an entry).
--
-- Rollback: ALTER TABLE "end_of_service_settlements" DROP CONSTRAINT "end_of_service_settlements_journal_entry_check";
--           ALTER TABLE "end_of_service_settlements" ALTER COLUMN "journal_entry_id" SET NOT NULL;
-- The SET NOT NULL fails while any zero-entitlement settlement (null entry) exists; those rows must
-- be dealt with by hand first -- they cannot be given an entry, because a zero entry cannot be posted.

ALTER TABLE "end_of_service_settlements" ALTER COLUMN "journal_entry_id" DROP NOT NULL;

-- The database, not only the service, guarantees that money owed always has an accrual entry.
ALTER TABLE "end_of_service_settlements" ADD CONSTRAINT "end_of_service_settlements_journal_entry_check"
  CHECK ("journal_entry_id" IS NOT NULL OR "net_entitlement" = 0);
