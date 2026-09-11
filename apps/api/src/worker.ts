// Worker process — docs/02-ARCHITECTURE-RULES.md §6: "The worker is a separate
// process from the API, even in Compose." Hosts every background job as a BullMQ
// queue + worker pair (docs/12-OPS-AND-DEPLOYMENT.md §5): the license check-in
// (docs/01-OPEN-DECISIONS.md A5) and the outbox relay (docs/06-COMPLIANCE-PACK-RULES.md
// §4). Business-specific consumer jobs (email, PDF, ZATCA submission) register here
// as they land in later milestones.
import { PrismaClient } from "@erp/db";
import { SystemClock } from "@erp/shared";
import { ActivationServiceClient, LicenseCheckinService, DEFAULT_CHECKIN_INTERVAL_MS } from "@erp/core";
import { createRedisConnection } from "./jobs/redis-connection.js";
import { createMonitoredWorker, createQueue } from "./jobs/create-monitored-worker.js";
import { DEFAULT_JOB_OPTIONS, type JobData } from "./jobs/job-conventions.js";
import { relayOutboxOnce } from "./jobs/outbox-relay.js";
import { workerLogger } from "./jobs/worker-logger.js";

// docs/04-DATA-MODEL-RULES.md §3: see the matching comment in main.ts — same
// UTC-consistency fallback for the worker process.
process.env.TZ = process.env.TZ ?? "UTC";

const LICENSE_CHECKIN_QUEUE = "license-checkin";
const OUTBOX_RELAY_QUEUE = "outbox-relay";
const OUTBOX_RELAY_INTERVAL_MS = 10_000;

const prisma = new PrismaClient();
const connection = createRedisConnection();

const activationClient = new ActivationServiceClient({
  serviceUrl: process.env.ACTIVATION_SERVICE_URL,
  masterKey: process.env.LICENSE_MASTER_KEY,
});
const checkin = new LicenseCheckinService(prisma, activationClient, new SystemClock());

const licenseCheckinQueue = createQueue<JobData>(LICENSE_CHECKIN_QUEUE, connection);
const { worker: licenseCheckinWorker, close: closeLicenseCheckinWorker } =
  createMonitoredWorker<JobData>(LICENSE_CHECKIN_QUEUE, connection, async (job) => {
    workerLogger.info({ queue: LICENSE_CHECKIN_QUEUE, correlationId: job.data.correlationId }, "job.started");
    await checkin.runCheckin();
  });

const outboxRelayQueue = createQueue<JobData>(OUTBOX_RELAY_QUEUE, connection);
const { worker: outboxRelayWorker, close: closeOutboxRelayWorker } = createMonitoredWorker<JobData>(
  OUTBOX_RELAY_QUEUE,
  connection,
  async (job) => {
    const dispatched = await relayOutboxOnce(prisma, connection);
    if (dispatched > 0) {
      workerLogger.info(
        { queue: OUTBOX_RELAY_QUEUE, correlationId: job.data.correlationId, dispatched },
        "job.outbox_relayed",
      );
    }
  },
);

// BullMQ v6 Job Schedulers (docs.bullmq.io/guide/job-schedulers) — the current,
// non-deprecated replacement for the old `repeat` job option. `upsertJobScheduler`
// is idempotent on the scheduler id, so calling this on every worker restart never
// creates a duplicate schedule.
async function scheduleRepeatableJobs(): Promise<void> {
  await licenseCheckinQueue.upsertJobScheduler(
    "license-checkin",
    { every: DEFAULT_CHECKIN_INTERVAL_MS },
    { name: "run", data: { correlationId: "license-checkin:scheduled" }, opts: DEFAULT_JOB_OPTIONS },
  );
  // Retrying the relay itself with backoff would just race the next scheduled
  // tick 10s later — one attempt per tick is the retry mechanism here.
  await outboxRelayQueue.upsertJobScheduler(
    "outbox-relay",
    { every: OUTBOX_RELAY_INTERVAL_MS },
    { name: "run", data: { correlationId: "outbox-relay:scheduled" }, opts: { ...DEFAULT_JOB_OPTIONS, attempts: 1 } },
  );
}

workerLogger.info("worker started");
void scheduleRepeatableJobs();

async function shutdown(): Promise<void> {
  workerLogger.info("worker shutting down");
  await closeLicenseCheckinWorker();
  await closeOutboxRelayWorker();
  await licenseCheckinQueue.close();
  await outboxRelayQueue.close();
  await connection.quit();
  await prisma.$disconnect();
}

process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));

void licenseCheckinWorker;
void outboxRelayWorker;
