// Thin BullMQ wrapper around @erp/compliance-zatca-sa's InvoiceSubmissionService. All the actual
// decision-making (hashing, signing, calling ZATCA, the chain, the retry/outcome classification)
// lives in that package, per docs/06-COMPLIANCE-PACK-RULES.md §1 — this file only knows how to
// turn a BullMQ job into a call to it, the same shape as ../notifications/notification.job.ts.
//
// docs/06 §4 / docs/02-ARCHITECTURE-RULES.md §5 ("never call an external HTTP service inside a
// database transaction"): InvoiceSubmissionService's chain lock is only safe when at most one
// submission runs per EGS unit at a time. That guarantee comes from here, not from the DB —
// create one Worker per EGS unit, each with `concurrency: 1` (createMonitoredWorker's new
// `workerOptions` parameter), on the queue `zatcaSubmissionQueueName(egsUnitId)`.
import { UnrecoverableError, type Job, type Processor } from "bullmq";
import { AlreadySubmittedError, InvoiceValidationError, type InvoiceSubmissionService, type SubmitInvoiceParams } from "@erp/compliance-zatca-sa";
import type { JobData } from "../jobs/job-conventions.js";

export type ZatcaSubmissionJobData = JobData & (
  | { readonly salesInvoiceId: string; readonly egsUnitId: string; readonly payload?: never }
  | { readonly payload: unknown; readonly outboxMessageId: string; readonly salesInvoiceId?: never; readonly egsUnitId?: never }
);

export function zatcaSubmissionQueueName(egsUnitId: string): string {
  return `zatca-submission-${egsUnitId}`;
}

// Everything InvoiceSubmissionService.submit() needs for one invoice — decrypted credentials,
// the certificate/key, which environment this EGS targets, and the invoice's own content mapped
// from the real SalesInvoice — assembled fresh per job, never carried in the job payload itself
// (docs/09-SECURITY-RULES.md §5: key material is never logged, and a BullMQ job payload is
// stored in Redis, so it is not somewhere a decrypted secret belongs either).
//
// ZatcaInvoiceMapper implements this seam; worker.ts registers it for each active issuing unit.
export interface ZatcaSubmissionParamsLoader {
  load(data: ZatcaSubmissionJobData): Promise<SubmitInvoiceParams>;
}

export function createZatcaSubmissionProcessor(service: InvoiceSubmissionService, loader: ZatcaSubmissionParamsLoader): Processor<ZatcaSubmissionJobData> {
  return async (job: Job<ZatcaSubmissionJobData>): Promise<void> => {
    const params = await loader.load(job.data);
    let result: Awaited<ReturnType<InvoiceSubmissionService["submit"]>>;
    try {
      result = await service.submit(params);
    } catch (error) {
      // At-least-once delivery or a double-click must not turn an accepted document into a failed job.
      if (error instanceof AlreadySubmittedError) return;
      // Our own pre-flight checks failed: the same data fails the same way, so BullMQ's backoff/retry
      // would only burn attempts. The reasons are on the ZatcaInvoiceRecord for the UI; a fix + an
      // explicit resubmit is what moves it forward.
      if (error instanceof InvoiceValidationError) throw new UnrecoverableError(error.message);
      throw error;
    }
    // PENDING_RETRY is the one outcome that must actually fail the BullMQ job — that is what
    // triggers DEFAULT_JOB_OPTIONS' backoff/retry (and eventually the dead-letter queue).
    // Every other outcome (including REJECTED and PACK_UNAVAILABLE) is already a final,
    // persisted state; throwing for those would just retry something retrying cannot fix.
    if (result.outcome.complianceOutcome.kind === "PENDING_RETRY") {
      throw new Error(`ZATCA submission for sales invoice ${job.data.salesInvoiceId} failed transiently and will be retried: ${result.outcome.errors.join("; ")}`);
    }
  };
}
