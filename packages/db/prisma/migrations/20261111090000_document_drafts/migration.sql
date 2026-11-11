CREATE TABLE document_drafts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT draft_payload_size CHECK (octet_length(payload::text) <= 262144)
);
CREATE INDEX document_drafts_company_id_user_id_updated_at_idx ON document_drafts(company_id, user_id, updated_at);
GRANT SELECT, INSERT, UPDATE ON document_drafts TO erp_app;
