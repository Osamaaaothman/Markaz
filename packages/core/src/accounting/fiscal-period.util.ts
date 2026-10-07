import type { TransactionClient } from "../contracts.js";

// The open fiscal period containing `date`, or null. Shared by PrismaAccountingEngine
// (reverseEntry posts to "now", not the original entry's period) and every M4 inventory
// posting service (a goods receipt/issue/count posts to the period containing its own
// document date) — three real call sites justify pulling this out of the engine
// (docs/00 §7: "two known implementations justify an interface").
export async function findOpenFiscalPeriod(tx: TransactionClient, companyId: string, date: Date) {
  return tx.fiscalPeriod.findFirst({
    where: { companyId, status: "OPEN", startDate: { lte: date }, endDate: { gte: date } },
    include: { fiscalYear: true },
  });
}
