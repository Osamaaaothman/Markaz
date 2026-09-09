#!/usr/bin/env node
// Sets erp_app's password to whatever DATABASE_URL currently says, using the
// migrator connection. Never hard-coded, never logged — read fresh from the
// environment every time this runs (idempotent, safe to run on every deploy).
// docs/09-SECURITY-RULES.md §1: no secrets in source; this is why the password
// creation lives here instead of in a committed migration.sql.
import pg from "pg";

const migrateUrl = process.env.MIGRATE_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;

if (!migrateUrl || !appUrl) {
  console.error("MIGRATE_DATABASE_URL and DATABASE_URL must both be set.");
  process.exit(1);
}

const appPassword = new URL(appUrl).password;
if (!appPassword) {
  console.error("DATABASE_URL has no password segment to sync to the erp_app role.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: migrateUrl });

try {
  await client.connect();
  // Postgres doesn't support a bind parameter for ALTER ROLE's password literal;
  // quote_literal() is Postgres's own safe escaping for this exact case (not string
  // interpolation on our side — docs/04-DATA-MODEL-RULES.md §8 "always parameterised").
  await client.query(
    "SELECT format('ALTER ROLE erp_app WITH LOGIN PASSWORD %L', $1::text) AS stmt",
    [appPassword],
  ).then(async (result) => {
    await client.query(result.rows[0].stmt);
  });
  console.log("erp_app password synced from DATABASE_URL.");
} finally {
  await client.end();
}
