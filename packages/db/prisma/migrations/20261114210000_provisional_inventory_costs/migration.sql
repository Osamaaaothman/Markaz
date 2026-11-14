-- Negative stock is an explicit owner-approved policy. Preserve prior posted records.
ALTER TABLE item_warehouse_stock DROP CONSTRAINT item_warehouse_stock_quantity_check;
ALTER TABLE item_warehouse_stock DROP CONSTRAINT item_warehouse_stock_value_check;
ALTER TABLE item_warehouse_stock ADD COLUMN last_unit_cost NUMERIC(27,8);
UPDATE item_warehouse_stock SET last_unit_cost = value / quantity WHERE quantity > 0;
-- Historical depleted pools retain the most recent actual issue/receipt cost, when known.
UPDATE item_warehouse_stock s SET last_unit_cost = m.unit_cost
FROM (SELECT DISTINCT ON (company_id,item_id,warehouse_id) company_id,item_id,warehouse_id,unit_cost
      FROM stock_movements WHERE quantity <> 0 ORDER BY company_id,item_id,warehouse_id,created_at DESC,id DESC) m
WHERE s.company_id=m.company_id AND s.item_id=m.item_id AND s.warehouse_id=m.warehouse_id AND s.last_unit_cost IS NULL;
ALTER TABLE item_warehouse_stock ADD CONSTRAINT stock_value_sign_check
  CHECK ((quantity > 0 AND value >= 0) OR (quantity < 0 AND value <= 0) OR (quantity = 0 AND value = 0));
ALTER TABLE item_warehouse_stock ADD CONSTRAINT stock_last_cost_check CHECK (last_unit_cost >= 0);

CREATE TABLE inventory_shortfalls (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id),
  item_id TEXT NOT NULL REFERENCES items(id), warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  source_document_type TEXT NOT NULL, source_document_id TEXT NOT NULL, line_number INTEGER NOT NULL,
  expense_account_id TEXT NOT NULL REFERENCES accounts(id),
  quantity NUMERIC(19,4) NOT NULL CHECK (quantity > 0),
  estimated_value NUMERIC(19,4) NOT NULL CHECK (estimated_value >= 0),
  cost_known BOOLEAN NOT NULL,
  remaining_quantity NUMERIC(19,4) NOT NULL,
  remaining_value NUMERIC(19,4) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (remaining_quantity >= 0 AND remaining_quantity <= quantity),
  CHECK (remaining_value >= 0 AND remaining_value <= estimated_value),
  CHECK (remaining_quantity <> 0 OR remaining_value = 0)
);
CREATE INDEX inventory_shortfalls_pool ON inventory_shortfalls(company_id,item_id,warehouse_id,created_at,id);
CREATE INDEX inventory_shortfalls_source ON inventory_shortfalls(company_id,source_document_type,source_document_id);
CREATE TABLE inventory_cost_settlements (
  id TEXT PRIMARY KEY, shortfall_id TEXT NOT NULL REFERENCES inventory_shortfalls(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  quantity NUMERIC(19,4) NOT NULL CHECK (quantity > 0),
  estimated_value NUMERIC(19,4) NOT NULL CHECK (estimated_value >= 0),
  actual_value NUMERIC(19,4) NOT NULL CHECK (actual_value >= 0),
  source_document_type TEXT NOT NULL, source_document_id TEXT NOT NULL,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (journal_entry_id IS NOT NULL OR actual_value = estimated_value)
);
GRANT SELECT, INSERT ON inventory_shortfalls, inventory_cost_settlements TO erp_app;
GRANT UPDATE (remaining_quantity, remaining_value) ON inventory_shortfalls TO erp_app;
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (movement_type IN ('RECEIPT','ISSUE','COUNT_ADJUSTMENT','RETURN','COST_ADJUSTMENT'));
-- An unvalued issue has a physical movement and pending cost, but no invented zero-value entry.
ALTER TABLE stock_issues ALTER COLUMN journal_entry_id DROP NOT NULL;
ALTER TABLE stock_movements ALTER COLUMN journal_entry_id DROP NOT NULL;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movement_posting_check CHECK (journal_entry_id IS NOT NULL OR value=0);
