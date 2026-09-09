-- Creates the restricted runtime role the API/worker connect as, and locks down
-- audit_log at the database level — CLAUDE.md §1 invariant #8 ("audit log is
-- append-only, no exceptions") and docs/04-DATA-MODEL-RULES.md §9.
--
-- No password is set here on purpose — a committed migration file is source, and
-- docs/09-SECURITY-RULES.md §1 forbids secrets in source. The real password is set
-- immediately after this migration runs, by
-- packages/db/scripts/sync-app-role-password.mjs, reading it from DATABASE_URL
-- (never hard-coded, never logged).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app WITH LOGIN;
  END IF;
END
$$;

-- Ordinary application tables: full DML, no DDL (schema changes are the migrator's
-- job only).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  companies, users, roles, permissions, role_permissions, user_roles,
  refresh_tokens, license_state
TO erp_app;

-- audit_log: append-only. INSERT and SELECT only — explicitly no UPDATE, no DELETE.
-- This is the actual enforcement docs/02-ARCHITECTURE-RULES.md §3.4 requires; the
-- application code having no update/delete method (packages/core/src/audit) is
-- belt-and-braces, not the real guarantee, since a bug could still call raw SQL.
GRANT SELECT, INSERT ON audit_log TO erp_app;
REVOKE UPDATE, DELETE ON audit_log FROM erp_app;
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

-- Sequences (if any get added by future migrations) follow the same DML-only rule.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO erp_app;
