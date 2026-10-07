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

// The series key a non-journal document is numbered under: the name of the fiscal year containing
// its date (the same key journal entries use), falling back to the calendar year when no fiscal
// year has been set up for that date yet — a request can be raised before the year is created.
export async function fiscalYearKeyFor(tx: TransactionClient, companyId: string, date: Date): Promise<string> {
  const year = await tx.fiscalYear.findFirst({
    where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
    select: { name: true },
  });
  return year?.name ?? String(date.getUTCFullYear());
}
