import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type {
  IAccountingEngine,
  INumberingService,
  PostingCommand,
  PostingResult,
  TransactionClient,
} from "../contracts.js";

export class InvalidPostingCommandError extends Error {}
export class AccountNotPostableError extends Error {}
export class FiscalPeriodNotFoundError extends Error {}

// The ONLY implementation of IAccountingEngine — docs/02-ARCHITECTURE-RULES.md §3.1.
// Modules never write journal entries themselves; this is the sanctioned entry
// point. See contracts.ts for why postEntry takes explicit lines rather than a
// "business terms" + account-mapping translation layer.
export class PrismaAccountingEngine implements IAccountingEngine {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly numbering: INumberingService,
  ) {}

  async postEntry(command: PostingCommand): Promise<PostingResult> {
    this.validateShape(command);

    return this.prisma.$transaction(async (tx) => {
      // Idempotency replay — docs/04-DATA-MODEL-RULES.md §6: "A replay returns the
      // original result, does not re-post, and does not consume a document number."
      const existing = await tx.journalEntry.findUnique({
        where: { companyId_idempotencyKey: { companyId: command.companyId, idempotencyKey: command.idempotencyKey } },
      });
      if (existing) {
        return { journalEntryId: existing.id, number: existing.number };
      }

      const period = await tx.fiscalPeriod.findUnique({
        where: { id: command.fiscalPeriodId },
        include: { fiscalYear: true },
      });
      if (!period || period.companyId !== command.companyId) {
        throw new FiscalPeriodNotFoundError(command.fiscalPeriodId);
      }
      // The database also rejects this (closed-period trigger) — this check exists
      // to fail with a clear application-level error before hitting the DB, not as
      // the real guarantee. The DB trigger is the real guarantee.
      if (period.status !== "OPEN") {
        throw new InvalidPostingCommandError(
          `Fiscal period ${command.fiscalPeriodId} is not open (status=${period.status})`,
        );
      }

      const accountIds = [...new Set(command.lines.map((l) => l.accountId))];
      const accounts = await tx.account.findMany({ where: { id: { in: accountIds } } });
      const accountsById = new Map(accounts.map((a) => [a.id, a]));
      for (const accountId of accountIds) {
        const account = accountsById.get(accountId);
        if (!account || account.companyId !== command.companyId) {
          throw new AccountNotPostableError(`Account ${accountId} not found in this company`);
        }
        if (!account.isPostable || !account.isActive) {
          throw new AccountNotPostableError(
            `Account ${account.code} (${account.name}) is not a postable leaf account`,
          );
        }
      }

      const rate = command.exchangeRate ? new Prisma.Decimal(command.exchangeRate) : new Prisma.Decimal(1);

      const number = await this.numbering.next(
        command.sourceDocumentType,
        { companyId: command.companyId, fiscalYear: period.fiscalYear.name },
        tx,
      );

      const journalEntryId = newId();
      await tx.journalEntry.create({
        data: {
          id: journalEntryId,
          companyId: command.companyId,
          fiscalPeriodId: command.fiscalPeriodId,
          number,
          entryDate: command.entryDate,
          postingDate: command.postingDate,
          currency: command.currency,
          exchangeRate: command.exchangeRate ?? null,
          sourceModule: command.sourceModule,
          sourceDocumentType: command.sourceDocumentType,
          sourceDocumentId: command.sourceDocumentId,
          actorId: command.actorId,
          correlationId: command.correlationId,
          idempotencyKey: command.idempotencyKey,
        },
      });

      await tx.journalEntryLine.createMany({
        data: command.lines.map((line, index) => {
          const debit = new Prisma.Decimal(line.debit ?? "0");
          const credit = new Prisma.Decimal(line.credit ?? "0");
          return {
            id: newId(),
            journalEntryId,
            accountId: line.accountId,
            debit,
            credit,
            baseDebit: debit.times(rate),
            baseCredit: credit.times(rate),
            description: line.description ?? null,
            lineNumber: index + 1,
          };
        }),
      });

      return { journalEntryId, number };
    });
  }

  async reverseEntry(
    entryId: string,
    reason: string,
    actorId: string,
    correlationId: string,
  ): Promise<PostingResult> {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.journalEntry.findUnique({
        where: { id: entryId },
        include: { lines: true, fiscalPeriod: { include: { fiscalYear: true } } },
      });
      if (!original) {
        throw new InvalidPostingCommandError(`Journal entry ${entryId} not found`);
      }

      // Reversal posts to the CURRENT open period, not necessarily the original
      // entry's period — docs/05-ACCOUNTING-INTEGRITY-RULES.md §2/§3: a reversal is
      // a new, dated entry; it does not require the original period to still be
      // open (it usually is not, or there would be no need to reverse via a new
      // entry rather than just fixing the draft).
      const targetPeriod = await this.findOpenPeriodContaining(tx, original.companyId, new Date());
      if (!targetPeriod) {
        throw new InvalidPostingCommandError(
          `No open fiscal period found to post the reversal of ${entryId}`,
        );
      }

      const number = await this.numbering.next(
        `${original.sourceDocumentType}_REVERSAL`,
        { companyId: original.companyId, fiscalYear: targetPeriod.fiscalYear.name },
        tx,
      );

      const reversalId = newId();
      await tx.journalEntry.create({
        data: {
          id: reversalId,
          companyId: original.companyId,
          fiscalPeriodId: targetPeriod.id,
          number,
          entryDate: new Date(),
          postingDate: new Date(),
          currency: original.currency,
          exchangeRate: original.exchangeRate,
          sourceModule: original.sourceModule,
          sourceDocumentType: original.sourceDocumentType,
          sourceDocumentId: original.sourceDocumentId,
          actorId,
          correlationId,
          idempotencyKey: `reversal:${entryId}:${newId()}`,
          reversalOfEntryId: original.id,
        },
      });

      // Flip debit/credit on every line — the exact mirrored entry, per
      // docs/05-ACCOUNTING-INTEGRITY-RULES.md §2: "Reversal produces the exact
      // expected mirrored entry."
      await tx.journalEntryLine.createMany({
        data: original.lines.map((line, index) => ({
          id: newId(),
          journalEntryId: reversalId,
          accountId: line.accountId,
          debit: line.credit,
          credit: line.debit,
          baseDebit: line.baseCredit,
          baseCredit: line.baseDebit,
          description: `Reversal (${reason}) of ${original.number}: ${line.description ?? ""}`.trim(),
          lineNumber: index + 1,
        })),
      });

      return { journalEntryId: reversalId, number };
    });
  }

  private async findOpenPeriodContaining(tx: TransactionClient, companyId: string, date: Date) {
    return tx.fiscalPeriod.findFirst({
      where: { companyId, status: "OPEN", startDate: { lte: date }, endDate: { gte: date } },
      include: { fiscalYear: true },
    });
  }

  private validateShape(command: PostingCommand): void {
    if (command.lines.length < 2) {
      throw new InvalidPostingCommandError("A journal entry must have at least 2 lines");
    }
    let debitTotal = new Prisma.Decimal(0);
    let creditTotal = new Prisma.Decimal(0);
    for (const line of command.lines) {
      const hasDebit = line.debit !== undefined && new Prisma.Decimal(line.debit).greaterThan(0);
      const hasCredit = line.credit !== undefined && new Prisma.Decimal(line.credit).greaterThan(0);
      if (hasDebit === hasCredit) {
        throw new InvalidPostingCommandError(
          `Line for account ${line.accountId} must have exactly one of debit/credit set`,
        );
      }
      debitTotal = debitTotal.plus(line.debit ?? "0");
      creditTotal = creditTotal.plus(line.credit ?? "0");
    }
    if (!debitTotal.equals(creditTotal)) {
      throw new InvalidPostingCommandError(
        `Journal entry does not balance: debit ${debitTotal.toFixed()} != credit ${creditTotal.toFixed()}`,
      );
    }
  }
}
