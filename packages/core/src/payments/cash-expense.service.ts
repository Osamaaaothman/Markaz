import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { allocateDocumentNumber } from "../reference.js";

export class CashExpenseError extends Error {
  constructor(
    readonly code: "CASH_ACCOUNT_NOT_FOUND" | "CASH_ACCOUNT_INVALID" | "EXPENSE_ACCOUNT_NOT_FOUND" | "EXPENSE_ACCOUNT_INVALID" | "NO_OPEN_PERIOD",
    message: string,
  ) {
    super(message);
    this.name = "CashExpenseError";
  }
}

export interface CreateCashExpenseInput {
  readonly expenseDate: Date;
  readonly amount: string;
  readonly cashAccountId: string;
  readonly expenseAccountId: string;
  readonly description?: string | undefined;
  readonly reference?: string | undefined;
}

export interface CashExpenseActor {
  readonly id: string;
  readonly companyId: string;
}

export interface CashExpenseResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
}

export interface CashExpenseSummary {
  readonly id: string;
  readonly number: string;
  readonly expenseDate: string;
  readonly amount: string;
  readonly currency: string;
  readonly cashAccountCode: string;
  readonly cashAccountName: string;
  readonly cashAccountNameAr: string | null;
  readonly expenseAccountCode: string;
  readonly expenseAccountName: string;
  readonly expenseAccountNameAr: string | null;
  readonly description: string | null;
  readonly reference: string | null;
}

export interface CashExpenseListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
}

export interface CashExpenseListPage {
  readonly data: readonly CashExpenseSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
const blankToNull = (v: string | null | undefined): string | null => (v?.trim() ? v.trim() : null);

function toSummary(row: {
  id: string;
  number: string;
  expenseDate: Date;
  amount: Prisma.Decimal;
  currency: string;
  description: string | null;
  reference: string | null;
  cashAccount: { code: string; name: string; nameAr: string | null };
  expenseAccount: { code: string; name: string; nameAr: string | null };
}): CashExpenseSummary {
  return {
    id: row.id,
    number: row.number,
    expenseDate: dateOnly(row.expenseDate),
    amount: row.amount.toFixed(4),
    currency: row.currency,
    cashAccountCode: row.cashAccount.code,
    cashAccountName: row.cashAccount.name,
    cashAccountNameAr: row.cashAccount.nameAr,
    expenseAccountCode: row.expenseAccount.code,
    expenseAccountName: row.expenseAccount.name,
    expenseAccountNameAr: row.expenseAccount.nameAr,
    description: row.description,
    reference: row.reference,
  };
}

// A small cash outlay straight to an expense: no supplier, no invoice, nothing to allocate later.
//   Dr expense account, Cr the petty-cash or bank account the money came out of     (the full amount)
// Posted the moment it is recorded — there is nothing to reconcile afterwards the way a payment can be.
export class CashExpenseService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly audit: IAuditLogger,
  ) {}

  async create(input: CreateCashExpenseInput, actor: CashExpenseActor, correlationId: string, idempotencyKey: string): Promise<CashExpenseResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const amount = new Prisma.Decimal(input.amount);

      const cash = await tx.account.findFirst({ where: { id: input.cashAccountId, companyId: actor.companyId } });
      if (!cash) throw new CashExpenseError("CASH_ACCOUNT_NOT_FOUND", "The cash or bank account was not found");
      if (!cash.isPostable || cash.type !== "ASSET") throw new CashExpenseError("CASH_ACCOUNT_INVALID", "Choose a postable asset account for the cash or bank");

      const expense = await tx.account.findFirst({ where: { id: input.expenseAccountId, companyId: actor.companyId } });
      if (!expense) throw new CashExpenseError("EXPENSE_ACCOUNT_NOT_FOUND", "The expense account was not found");
      if (!expense.isPostable || expense.type !== "EXPENSE") throw new CashExpenseError("EXPENSE_ACCOUNT_INVALID", "Choose a postable expense account");

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.expenseDate);
      if (!period) throw new CashExpenseError("NO_OPEN_PERIOD", "No open fiscal period covers the expense date");
      const currency = await companyCurrency(tx, actor.companyId);

      const journalLines: JournalLineInput[] = [
        { accountId: expense.id, debit: amount.toFixed(4), description: "Cash expense" },
        { accountId: cash.id, credit: amount.toFixed(4), description: "Cash expense" },
      ];

      const expenseId = newId();
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: input.expenseDate,
          postingDate: input.expenseDate,
          currency,
          lines: journalLines,
          sourceModule: "payments",
          sourceDocumentType: "cash_expense",
          sourceDocumentId: expenseId,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.expenseDate);
      const number = await allocateDocumentNumber(tx, actor.companyId, "cash_expense_no", "CEX", fiscalYear);

      await tx.cashExpense.create({
        data: {
          id: expenseId,
          companyId: actor.companyId,
          number,
          expenseDate: input.expenseDate,
          amount,
          currency,
          cashAccountId: cash.id,
          expenseAccountId: expense.id,
          description: blankToNull(input.description),
          reference: blankToNull(input.reference),
          journalEntryId: posting.journalEntryId,
          actorId: actor.id,
          correlationId,
        },
      });

      return { id: expenseId, number, journalEntryId: posting.journalEntryId };
    });

    await this.audit.log({ actorId: actor.id, action: "cash_expense.posted", entityType: "CashExpense", entityId: result.id, after: { ...result }, correlationId });
    return result;
  }

  async list(companyId: string, query: CashExpenseListQuery): Promise<CashExpenseListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.cashExpense.findMany({
      where: { companyId },
      include: { cashAccount: { select: { code: true, name: true, nameAr: true } }, expenseAccount: { select: { code: true, name: true, nameAr: true } } },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { data: page.map(toSummary), pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null } };
  }
}
