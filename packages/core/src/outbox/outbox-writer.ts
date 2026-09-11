import { newId } from "@erp/shared";
import type { Prisma } from "@erp/db";
import type { TransactionClient } from "../contracts.js";

export interface OutboxMessageInput {
  readonly companyId: string;
  // Past-tense domain event name (docs/02-ARCHITECTURE-RULES.md §7), e.g.
  // "invoice.issued" — becomes the BullMQ queue name at relay time
  // (apps/api/src/jobs/outbox-relay.ts).
  readonly topic: string;
  readonly payload: Record<string, unknown>;
  readonly correlationId: string;
}

// docs/06-COMPLIANCE-PACK-RULES.md §4: "the intent to submit is written in the same
// transaction as the document." Callers pass the SAME transaction client they used
// to create the business record — never a fresh one — so a rollback of the
// business change rolls this back too, and a commit of the business change commits
// this too. There is deliberately no non-transactional variant of this function.
export async function writeOutboxMessage(tx: TransactionClient, input: OutboxMessageInput): Promise<void> {
  await tx.outboxMessage.create({
    data: {
      id: newId(),
      companyId: input.companyId,
      topic: input.topic,
      payload: input.payload as Prisma.InputJsonValue,
      correlationId: input.correlationId,
    },
  });
}
