import type { JobsOptions } from "bullmq";

// docs/02-ARCHITECTURE-RULES.md §6: "Every job carries tenantId and correlationId."
// `correlationId` is universal; `companyId` is present on every job that acts on a
// specific company's data (the normal case — invoices, emails, PDFs) and omitted
// only for the handful of deployment-wide platform jobs (license check-in, the
// outbox relay itself) that have no single company to attach to.
export interface JobData {
  correlationId: string;
  companyId?: string;
}

// docs/02 §6 / docs/12-OPS-AND-DEPLOYMENT.md §5: "bounded retries with exponential
// backoff and jitter, then a dead-letter queue with an alert." 5 attempts topping
// out at ~80s between tries is deliberately generous for a background job (nothing
// here blocks an HTTP request) — jobs that call an unreliable external system
// (ZATCA, email) may override `attempts`/`backoff` per-queue when they land.
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5_000, jitter: 0.5 },
  // Keep a bounded history for support visibility (docs/12 §5: "Job state visible
  // to support") without letting Redis grow unbounded.
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
};

export function isFinalAttempt(attemptsMade: number, attempts: number | undefined): boolean {
  return attemptsMade >= (attempts ?? DEFAULT_JOB_OPTIONS.attempts ?? 1);
}
