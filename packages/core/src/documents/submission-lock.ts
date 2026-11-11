import type { TransactionClient } from "../contracts.js";

/** Serialize retries before allocating a number, including requests arriving concurrently. */
export async function lockSubmission(
  tx: TransactionClient,
  companyId: string,
  kind: string,
  key?: string,
): Promise<void> {
  if (key)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${companyId}:${kind}:${key}`}, 0))`;
}
