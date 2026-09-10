-- Ledger integrity, enforced at the database level — CLAUDE.md §1 invariants #1-#2,
-- docs/05-ACCOUNTING-INTEGRITY-RULES.md §1, docs/04-DATA-MODEL-RULES.md §9. Do not
-- rely on application code alone: application bugs are inevitable.

-- ============================================================================
-- 1. Every line has exactly one of debit/credit, non-negative, non-zero.
-- ============================================================================
ALTER TABLE journal_entry_lines
  ADD CONSTRAINT journal_entry_lines_debit_credit_check
  CHECK (
    debit >= 0 AND credit >= 0 AND
    ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
  );

ALTER TABLE journal_entry_lines
  ADD CONSTRAINT journal_entry_lines_base_debit_credit_check
  CHECK (
    base_debit >= 0 AND base_credit >= 0 AND
    ((base_debit > 0 AND base_credit = 0) OR (base_credit > 0 AND base_debit = 0))
  );

-- ============================================================================
-- 2. A journal entry's lines sum to zero (debits == credits) at commit — in both
--    the transaction currency and the base currency (docs/05 §1 point 7). A
--    DEFERRED constraint trigger checks the actual state at COMMIT, not at each
--    individual row event, so inserting a multi-line entry's lines one at a time
--    inside one transaction works correctly. Also enforces "every journal entry
--    has >= 2 lines" (docs/05 §1 point 1) in the same pass.
-- ============================================================================
CREATE OR REPLACE FUNCTION check_journal_entry_balance() RETURNS TRIGGER AS $$
DECLARE
  entry_id TEXT;
  line_count INTEGER;
  debit_total NUMERIC(19,4);
  credit_total NUMERIC(19,4);
  base_debit_total NUMERIC(19,4);
  base_credit_total NUMERIC(19,4);
BEGIN
  entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

  SELECT COUNT(*), COALESCE(SUM(debit),0), COALESCE(SUM(credit),0),
         COALESCE(SUM(base_debit),0), COALESCE(SUM(base_credit),0)
  INTO line_count, debit_total, credit_total, base_debit_total, base_credit_total
  FROM journal_entry_lines
  WHERE journal_entry_id = entry_id;

  IF line_count < 2 THEN
    RAISE EXCEPTION 'Journal entry % has fewer than 2 lines (%)', entry_id, line_count;
  END IF;

  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'Journal entry % does not balance: debit % <> credit %',
      entry_id, debit_total, credit_total;
  END IF;

  IF base_debit_total <> base_credit_total THEN
    RAISE EXCEPTION 'Journal entry % does not balance in base currency: % <> %',
      entry_id, base_debit_total, base_credit_total;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_entry_lines_balance_check
  AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_journal_entry_balance();

-- ============================================================================
-- 3. No posting into a closed fiscal period — docs/05 §3.
-- ============================================================================
CREATE OR REPLACE FUNCTION check_fiscal_period_open() RETURNS TRIGGER AS $$
DECLARE
  period_status TEXT;
BEGIN
  SELECT status INTO period_status FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF period_status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'Cannot post journal entry: fiscal period % is not open (status=%)',
      NEW.fiscal_period_id, period_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_period_open_check
  BEFORE INSERT ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION check_fiscal_period_open();

-- ============================================================================
-- 4. Account type / normal balance / period status enumerations.
-- ============================================================================
ALTER TABLE accounts
  ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'));

ALTER TABLE accounts
  ADD CONSTRAINT accounts_normal_balance_check
  CHECK (normal_balance IN ('DEBIT', 'CREDIT'));

ALTER TABLE fiscal_years
  ADD CONSTRAINT fiscal_years_status_check
  CHECK (status IN ('OPEN', 'CLOSED'));

ALTER TABLE fiscal_periods
  ADD CONSTRAINT fiscal_periods_status_check
  CHECK (status IN ('OPEN', 'CLOSED', 'LOCKED'));

-- ============================================================================
-- 5. journal_entries / journal_entry_lines are append-only for the runtime role —
--    CLAUDE.md §1 invariant #2, docs/05 §2: "If you find yourself writing an
--    UPDATE against journal_entries or journal_entry_lines, stop." Same pattern
--    already proven for audit_log in M1 — a table owner always retains full DML
--    rights regardless of REVOKE, so this only works because erp_app is genuinely
--    not the owner (erp_migrator is).
-- ============================================================================
GRANT SELECT, INSERT ON journal_entries TO erp_app;
REVOKE UPDATE, DELETE ON journal_entries FROM erp_app;
REVOKE UPDATE, DELETE ON journal_entries FROM PUBLIC;

GRANT SELECT, INSERT ON journal_entry_lines TO erp_app;
REVOKE UPDATE, DELETE ON journal_entry_lines FROM erp_app;
REVOKE UPDATE, DELETE ON journal_entry_lines FROM PUBLIC;

-- ============================================================================
-- 6. Ordinary DML grants for the rest of the M2 tables.
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON currencies, exchange_rates TO erp_app;
GRANT SELECT, INSERT, UPDATE ON fiscal_years, fiscal_periods, accounts TO erp_app;
GRANT SELECT, INSERT, UPDATE ON document_number_series TO erp_app;
