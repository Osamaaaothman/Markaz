import { Queue, Worker, type Job, type Processor } from "bullmq";
import type IORedis from "ioredis";
import { DEFAULT_JOB_OPTIONS, isFinalAttempt, type JobData } from "./job-conventions.js";
import { workerLogger } from "./worker-logger.js";

// BullMQ rejects a queue name containing ":" (it uses that character internally
// in its own Redis key namespacing) — caught by create-monitored-worker.integration.spec.ts
// against a real Redis, not assumed from the docs.
export function deadLetterQueueName(queueName: string): string {
  return `${queueName}-dlq`;
}

export interface DeadLetterPayload {
  originalQueue: string;
  jobId: string | undefined;
  data: JobData;
  attemptsMade: number;
  failedReason: string;
  failedAt: string;
}

export interface MonitoredWorker {
  worker: Worker;
  deadLetterQueue: Queue<DeadLetterPayload>;
  close: () => Promise<void>;
}

// docs/12-OPS-AND-DEPLOYMENT.md §5: "bounded retries..., then a dead-letter queue
// with an alert. Silent permanent failure is not acceptable for a tax obligation."
// This wraps a BullMQ Worker so every queue gets that behaviour the same way,
// instead of each job re-implementing it. On a retryable failure, BullMQ itself
// re-queues the job per DEFAULT_JOB_OPTIONS.backoff — this only acts once
// `attemptsMade` reaches the job's configured `attempts` ceiling.
export function createMonitoredWorker<T extends JobData>(
  queueName: string,
  connection: IORedis,
  processor: Processor<T>,
): MonitoredWorker {
  const worker = new Worker<T>(queueName, processor, { connection });
  const deadLetterQueue = new Queue<DeadLetterPayload>(deadLetterQueueName(queueName), { connection });

  worker.on("failed", (job: Job<T> | undefined, error: Error) => {
    if (job === undefined) {
      workerLogger.error({ queue: queueName, err: error.message }, "job.failed_without_job_reference");
      return;
    }
    const log = {
      queue: queueName,
      jobId: job.id,
      ...(job.data.companyId !== undefined ? { companyId: job.data.companyId } : {}),
      correlationId: job.data.correlationId,
      attemptsMade: job.attemptsMade,
      attempts: job.opts.attempts,
      err: error.message,
    };
    if (!isFinalAttempt(job.attemptsMade, job.opts.attempts)) {
      workerLogger.warn(log, "job.retrying");
      return;
    }
    // Final attempt exhausted — this is the dead-letter + alert path.
    // REVIEW: no real alert transport (PagerDuty/Slack/etc.) is wired yet; this
    // error-level structured log is the hook for one, not the alert itself. Known
    // gap, tracked until a real customer needs it (docs/12 §7 "alerts that matter").
    workerLogger.error(log, "job.dead_lettered");
    void deadLetterQueue.add(job.name, {
      originalQueue: queueName,
      jobId: job.id,
      data: job.data,
      attemptsMade: job.attemptsMade,
      failedReason: error.message,
      failedAt: new Date().toISOString(),
    });
  });

  return {
    worker,
    deadLetterQueue,
    close: async () => {
      await worker.close();
      await deadLetterQueue.close();
    },
  };
}

export function createQueue<T extends JobData>(queueName: string, connection: IORedis): Queue<T> {
  return new Queue<T>(queueName, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
}
