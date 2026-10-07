import type { TransactionClient } from "../contracts.js";

// A company posts in its own base currency. Stock and purchasing documents are single-currency in
// this version, so they all read it from here rather than assuming one.
export async function companyCurrency(tx: TransactionClient, companyId: string): Promise<string> {
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { defaultCurrency: true } });
  return company.defaultCurrency;
}
