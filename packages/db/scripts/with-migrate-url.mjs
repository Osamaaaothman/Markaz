#!/usr/bin/env node
// Runs a command with DATABASE_URL swapped to MIGRATE_DATABASE_URL (the schema-owner
// role), so migrations never accidentally run as the restricted runtime role.
// Cross-platform (Windows/macOS/Linux) instead of shell-specific `VAR=val cmd`.
import { spawnSync } from "node:child_process";

const migrateUrl = process.env.MIGRATE_DATABASE_URL;
if (!migrateUrl) {
  console.error("MIGRATE_DATABASE_URL is not set — see .env.example.");
  process.exit(1);
}

const [, , ...cmd] = process.argv;
const result = spawnSync(cmd[0], cmd.slice(1), {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: migrateUrl },
});

process.exit(result.status ?? 1);
