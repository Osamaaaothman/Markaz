// Worker process — docs/02-ARCHITECTURE-RULES.md §6: "The worker is a separate
// process from the API, even in Compose." Runs the license check-in job
// (docs/01-OPEN-DECISIONS.md A5). BullMQ-based job consumers for ZATCA/email/reports
// land in M3 — this is deliberately just the one job M1 needs.
import { PrismaClient } from "@erp/db";
import { SystemClock } from "@erp/shared";
import { ActivationServiceClient, LicenseCheckinService, DEFAULT_CHECKIN_INTERVAL_MS } from "@erp/core";

// docs/04-DATA-MODEL-RULES.md §3: see the matching comment in main.ts — same
// UTC-consistency fallback for the worker process.
process.env.TZ = process.env.TZ ?? "UTC";

const prisma = new PrismaClient();
const client = new ActivationServiceClient({
  serviceUrl: process.env.ACTIVATION_SERVICE_URL,
  masterKey: process.env.LICENSE_MASTER_KEY,
});
const checkin = new LicenseCheckinService(prisma, client, new SystemClock());

async function runOnce(): Promise<void> {
  try {
    await checkin.runCheckin();
  } catch (error) {
    // A failed check-in attempt must not crash the worker — it just tries again
    // next interval. The grace-period logic (packages/core/src/licensing) is what
    // keeps the deployment usable in the meantime.
    process.stderr.write(`[worker] license check-in failed: ${String(error)}\n`);
  }
}

process.stdout.write("[worker] started — running license check-in job\n");
void runOnce();
setInterval(() => void runOnce(), DEFAULT_CHECKIN_INTERVAL_MS);
