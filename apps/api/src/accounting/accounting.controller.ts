import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import type { IAccountingEngine, PostingResult } from "@erp/core";
import {
  BalanceSheetService,
  IncomeStatementService,
  TrialBalanceService,
  type BalanceSheetResult,
  type IncomeStatementResult,
  type TrialBalanceResult,
} from "@erp/core";
import { Money } from "@erp/shared";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ACCOUNTING_ENGINE } from "./accounting.tokens.js";
import { PostJournalEntryDto } from "./dto/post-journal-entry.dto.js";
import { ReverseJournalEntryDto } from "./dto/reverse-journal-entry.dto.js";
import { IncomeStatementQueryDto } from "./dto/income-statement-query.dto.js";
import type { AccountSummary, FiscalPeriodSummary, JournalEntryListPage } from "./accounting-reads.types.js";

@Controller("v1")
export class AccountingController {
  constructor(
    @Inject(ACCOUNTING_ENGINE) private readonly engine: IAccountingEngine,
    private readonly trialBalanceService: TrialBalanceService,
    private readonly balanceSheetService: BalanceSheetService,
    private readonly incomeStatementService: IncomeStatementService,
    private readonly prisma: PrismaService,
  ) {}

  // docs/07-API-RULES.md §6: every list endpoint paginates — these are small,
  // bounded reference lists (chart of accounts, fiscal periods for one company),
  // so a plain full read is the documented exception, not cursor pagination.
  @Get("accounts")
  @RequirePermission("account", "read")
  async listAccounts(@CurrentUser() actor: CurrentUserPayload): Promise<AccountSummary[]> {
    const accounts = await this.prisma.account.findMany({
      where: { companyId: actor.companyId, isPostable: true, isActive: true },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    });
    return accounts;
  }

  @Get("fiscal-periods")
  @RequirePermission("fiscal_period", "read")
  async listFiscalPeriods(@CurrentUser() actor: CurrentUserPayload): Promise<FiscalPeriodSummary[]> {
    const periods = await this.prisma.fiscalPeriod.findMany({
      where: { companyId: actor.companyId, status: "OPEN" },
      select: { id: true, periodNumber: true, startDate: true, endDate: true },
      orderBy: { startDate: "asc" },
    });
    return periods.map((p) => ({
      id: p.id,
      periodNumber: p.periodNumber,
      startDate: p.startDate.toISOString(),
      endDate: p.endDate.toISOString(),
    }));
  }

  // Cursor-based (docs/07-API-RULES.md §6: "Cursor-based for large or growing
  // sets") — journal entries accumulate for the life of the deployment, unlike
  // accounts/fiscal-periods above.
  @Get("journal-entries")
  @RequirePermission("journal_entry", "read")
  async listJournalEntries(
    @CurrentUser() actor: CurrentUserPayload,
    @Query("cursor") cursor?: string,
    @Query("limit") limitParam?: string,
  ): Promise<JournalEntryListPage> {
    const limit = Math.min(Math.max(Number.parseInt(limitParam ?? "20", 10) || 20, 1), 100);
    const entries = await this.prisma.journalEntry.findMany({
      where: { companyId: actor.companyId },
      select: {
        id: true,
        number: true,
        entryDate: true,
        currency: true,
        sourceDocumentType: true,
        sourceDocumentId: true,
        reversalOfEntryId: true,
        lines: { select: { debit: true, credit: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;

    return {
      data: page.map((entry) => ({
        id: entry.id,
        number: entry.number,
        entryDate: entry.entryDate.toISOString(),
        currency: entry.currency,
        sourceDocumentType: entry.sourceDocumentType,
        sourceDocumentId: entry.sourceDocumentId,
        isReversal: entry.reversalOfEntryId !== null,
        // CLAUDE.md §1 invariant #3 / docs/04-DATA-MODEL-RULES.md §2: money is
        // never a float — even for a display-only list total, Money's decimal
        // arithmetic is used, never `Number(...)`.
        totalDebit: entry.lines
          .reduce((sum, line) => sum.add(Money.of(line.debit.toString(), entry.currency)), Money.zero(entry.currency))
          .toDecimalString(),
      })),
      pageInfo: {
        hasMore,
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      },
    };
  }

  // docs/05-ACCOUNTING-INTEGRITY-RULES.md §7: "Trial balance — must always be zero.
  // Expose it in development as a health check."
  @Get("trial-balance")
  @RequirePermission("trial_balance", "read")
  trialBalance(@CurrentUser() actor: CurrentUserPayload): Promise<TrialBalanceResult> {
    return this.trialBalanceService.compute(actor.companyId);
  }

  @Get("balance-sheet")
  @RequirePermission("balance_sheet", "read")
  balanceSheet(@CurrentUser() actor: CurrentUserPayload): Promise<BalanceSheetResult> {
    return this.balanceSheetService.compute(actor.companyId);
  }

  @Get("income-statement")
  @RequirePermission("income_statement", "read")
  incomeStatement(
    @CurrentUser() actor: CurrentUserPayload,
    @Query() query: IncomeStatementQueryDto,
  ): Promise<IncomeStatementResult> {
    return this.incomeStatementService.compute(actor.companyId, new Date(query.from), new Date(query.to));
  }

  @Post("journal-entries")
  @RequirePermission("journal_entry", "create")
  postJournalEntry(
    @Body() dto: PostJournalEntryDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<PostingResult> {
    return this.engine.postEntry({
      companyId: actor.companyId,
      fiscalPeriodId: dto.fiscalPeriodId,
      entryDate: new Date(dto.entryDate),
      postingDate: new Date(dto.postingDate),
      currency: dto.currency,
      ...(dto.exchangeRate !== undefined ? { exchangeRate: dto.exchangeRate } : {}),
      lines: dto.lines,
      sourceModule: "manual",
      sourceDocumentType: dto.sourceDocumentType,
      sourceDocumentId: dto.sourceDocumentId,
      actorId: actor.id,
      correlationId,
      idempotencyKey,
    });
  }

  @Post("journal-entries/:id/reverse")
  @RequirePermission("journal_entry", "reverse")
  reverseJournalEntry(
    @Param("id") id: string,
    @Body() dto: ReverseJournalEntryDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<PostingResult> {
    return this.engine.reverseEntry(id, dto.reason, actor.id, correlationId);
  }
}
