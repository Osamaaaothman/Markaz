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
import type { Job, Processor } from "bullmq";
import type { InvoiceSubmissionService, SubmitInvoiceParams } from "@erp/compliance-zatca-sa";
import type { JobData } from "../jobs/job-conventions.js";

export interface ZatcaSubmissionJobData extends JobData {
  readonly salesInvoiceId: string;
  readonly egsUnitId: string;
}

export function zatcaSubmissionQueueName(egsUnitId: string): string {
  return `zatca-submission-${egsUnitId}`;
}

// Everything InvoiceSubmissionService.submit() needs for one invoice — decrypted credentials,
// the certificate/key, which environment this EGS targets, and the invoice's own content mapped
// from the real SalesInvoice — assembled fresh per job, never carried in the job payload itself
// (docs/09-SECURITY-RULES.md §5: key material is never logged, and a BullMQ job payload is
// stored in Redis, so it is not somewhere a decrypted secret belongs either).
//
// NOT IMPLEMENTED YET. Blocked on two things neither of which exists in this codebase yet:
//   1. A real EgsCredential row to decrypt (Phase 2 onboarding — not built).
//   2. A product decision this repo has not made: how a SalesInvoice determines which EGS/branch
//      issued it (SalesInvoice has no such field today). Needs Osama's input, not a guess
//      (CLAUDE.md §4) — a single-EGS company could default to "the company's only EgsUnit", but
//      multi-branch needs a real field and a real decision.
// Until both exist, this interface is the seam a real loader plugs into; nothing calls it yet.
export interface ZatcaSubmissionParamsLoader {
  load(data: ZatcaSubmissionJobData): Promise<SubmitInvoiceParams>;
}

export function createZatcaSubmissionProcessor(service: InvoiceSubmissionService, loader: ZatcaSubmissionParamsLoader): Processor<ZatcaSubmissionJobData> {
  return async (job: Job<ZatcaSubmissionJobData>): Promise<void> => {
    const params = await loader.load(job.data);
    const result = await service.submit(params);
    // PENDING_RETRY is the one outcome that must actually fail the BullMQ job — that is what
    // triggers DEFAULT_JOB_OPTIONS' backoff/retry (and eventually the dead-letter queue).
    // Every other outcome (including REJECTED and PACK_UNAVAILABLE) is already a final,
    // persisted state; throwing for those would just retry something retrying cannot fix.
    if (result.outcome.complianceOutcome.kind === "PENDING_RETRY") {
      throw new Error(`ZATCA submission for sales invoice ${job.data.salesInvoiceId} failed transiently and will be retried: ${result.outcome.errors.join("; ")}`);
    }
  };
}
