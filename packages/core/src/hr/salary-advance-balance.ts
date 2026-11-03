import { Prisma, type PrismaClient } from "@erp/db";

// The remaining balance of a salary advance is never stored: it is the amount minus what payroll has already deducted
// minus what the employee has paid back directly. One place computes it, so a list, a payroll run and an end-of-service
// check can never disagree about what an employee still owes.
export interface AdvanceBalanceInput {
  readonly amount: Prisma.Decimal;
  readonly deductions: readonly { readonly amount: Prisma.Decimal }[];
  readonly repayments: readonly { readonly amount: Prisma.Decimal }[];
}

export interface AdvanceBalance {
  readonly deducted: Prisma.Decimal;
  readonly repaid: Prisma.Decimal;
  readonly remaining: Prisma.Decimal;
}

const sum = (rows: readonly { readonly amount: Prisma.Decimal }[]): Prisma.Decimal => rows.reduce((total, row) => total.plus(row.amount), new Prisma.Decimal(0));

export function advanceBalance(advance: AdvanceBalanceInput): AdvanceBalance {
  const deducted = sum(advance.deductions);
  const repaid = sum(advance.repayments);
  return { deducted, repaid, remaining: advance.amount.minus(deducted).minus(repaid) };
}

// What one employee still owes across every advance. Takes the client so a settlement can check it inside its transaction.
export async function outstandingAdvanceTotal(
  db: Pick<PrismaClient, "salaryAdvance">,
  companyId: string,
  employeeId: string,
): Promise<Prisma.Decimal> {
  const advances = await db.salaryAdvance.findMany({ where: { companyId, employeeId }, include: { deductions: true, repayments: true } });
  return advances.reduce((total, advance) => total.plus(Prisma.Decimal.max(advanceBalance(advance).remaining, 0)), new Prisma.Decimal(0));
}

// Serialises everything that reads and then spends an employee's advance balance (a repayment, a payroll run). salary_advances
// is insert-only for the application role, so SELECT ... FOR UPDATE is not allowed on it; a transaction-scoped advisory
// lock per employee does the same job without any table privilege. Locks are taken in a fixed order so two payroll runs
// or a run and a repayment cannot deadlock. They are released when the transaction ends.
export async function lockAdvancesOf(
  tx: Pick<PrismaClient, "$executeRaw">,
  companyId: string,
  employeeIds: readonly string[],
): Promise<void> {
  for (const employeeId of [...new Set(employeeIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`salary-advances:${companyId}:${employeeId}`}, 0))`;
  }
}
