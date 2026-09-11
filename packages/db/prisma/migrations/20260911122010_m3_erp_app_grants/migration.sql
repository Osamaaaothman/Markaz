-- docs/04-DATA-MODEL-RULES.md §9 / the two-role pattern established in
-- 20260908233000_restrict_app_role and 20260910110000_ledger_integrity_constraints:
-- a new table is NOT usable by the restricted runtime role until explicitly
-- granted here — Postgres does not retroactively grant privileges on tables
-- created after a role's initial GRANT statements.

-- outbox_messages: business code INSERTs inside its own transaction
-- (writeOutboxMessage); the worker's relay (also running as erp_app) UPDATEs
-- dispatched_at via the atomic claim query (apps/api/src/jobs/outbox-relay.ts).
-- No DELETE — a dispatched row stays as the audit trail of what was announced.
GRANT SELECT, INSERT, UPDATE ON outbox_messages TO erp_app;

-- approval_policies: company configuration, read by evaluateAndRequest, written by
-- whatever future settings screen lets a company set its own thresholds. No DELETE
-- yet — nothing removes a policy today; add it when that use case exists.
GRANT SELECT, INSERT, UPDATE ON approval_policies TO erp_app;

-- approval_requests: created by evaluateAndRequest, moved out of PENDING by
-- decide(). No DELETE — same reasoning as journal_entries: a decision is a fact,
-- not something to erase.
GRANT SELECT, INSERT, UPDATE ON approval_requests TO erp_app;
