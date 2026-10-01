import type { PrismaClient } from "@erp/db";
import type IORedis from "ioredis";
import { createQueue } from "./create-monitored-worker.js";
import type { JobData } from "./job-conventions.js";

export interface OutboxJobData extends JobData {
  companyId: string;
  outboxMessageId: string;
  payload: unknown;
}

const RELAY_BATCH_SIZE = 100;

interface ClaimedRow {
  id: string;
  company_id: string;
  topic: string;
  payload: unknown;
  correlation_id: string;
}

// docs/06-COMPLIANCE-PACK-RULES.md §4 / docs/02-ARCHITECTURE-RULES.md §6-7: the
// whole point of the outbox is that dispatch does not depend on the original
// request's process staying alive — a separate relay (this function, run on a
// repeatable schedule by the worker process) picks up whatever was committed and
// enqueues it. This is a plain Postgres-as-queue claim: the UPDATE...WHERE id IN
// (SELECT ... FOR UPDATE SKIP LOCKED) is a single atomic statement, so two relay
// runs (or two worker replicas, later) never claim the same row — this is the
// documented reason a raw query was needed here instead of the Prisma query
// builder (docs/04-DATA-MODEL-RULES.md §8).
//
// Not tenant-scoped by companyId: this relay intentionally processes every
// company's pending messages in one deployment's single database — a company here
// is ordinary data scoping within one customer's deployment, not the cross-customer
// security boundary docs/03-MULTI-TENANCY-RULES.md guards (there is no shared
// platform to leak across).
//
// REVIEW: claim-then-enqueue, not two-phase claim/confirm — if the process crashes
// in the narrow window between this UPDATE committing and the matching
// `queue.add()` below, that row is marked dispatched but was never actually
// enqueued. Accepted for now (the window is a handful of in-process statements,
// not a network round trip) rather than building a confirm step with no real
// production consumer yet to justify it.
export async function relayOutboxOnce(prisma: PrismaClient, connection: IORedis): Promise<number> {
  const claimed = await prisma.$queryRaw<ClaimedRow[]>`
    UPDATE outbox_messages
    SET dispatched_at = now()
    WHERE id IN (
      SELECT id FROM outbox_messages
      WHERE dispatched_at IS NULL
      ORDER BY created_at
      LIMIT ${RELAY_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, company_id, topic, payload, correlation_id
  `;

  for (const row of claimed) {
    const queue = createQueue<OutboxJobData>(row.topic, connection);
    await queue.add(row.topic, {
      companyId: row.company_id,
      correlationId: row.correlation_id,
      outboxMessageId: row.id,
      payload: row.payload,
    });
    await queue.close();
  }

  return claimed.length;
}
