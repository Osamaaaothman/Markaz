import { Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import type { IAccountingEngine, PostingResult } from "@erp/core";
import {
  BalanceSheetService,
  IncomeStatementService,
  TrialBalanceService,
  type BalanceSheetResult,
  type IncomeStatementResult,
  type TrialBalanceResult,
} from "@erp/core";
import { Money, newId } from "@erp/shared";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingExportService, type ExportedFile } from "./accounting-export.service.js";
import { ACCOUNTING_ENGINE } from "./accounting.tokens.js";
import { PostJournalEntryDto } from "./dto/post-journal-entry.dto.js";
import { ReverseJournalEntryDto } from "./dto/reverse-journal-entry.dto.js";
import { IncomeStatementQueryDto } from "./dto/income-statement-query.dto.js";
import { ExportQueryDto } from "./dto/export-query.dto.js";
import { IncomeStatementExportQueryDto } from "./dto/income-statement-export-query.dto.js";
import { JournalEntriesQueryDto } from "./dto/journal-entries-query.dto.js";
import { CreateAccountDto, normalBalanceFor } from "./dto/create-account.dto.js";
import type {
  AccountSummary,
  ChartOfAccountEntry,
  FiscalPeriodSummary,
  JournalEntryListPage,
} from "./accounting-reads.types.js";

@Controller("v1")
export class AccountingController {
  constructor(
    @Inject(ACCOUNTING_ENGINE) private readonly engine: IAccountingEngine,
    private readonly trialBalanceService: TrialBalanceService,
    private readonly balanceSheetService: BalanceSheetService,
    private readonly incomeStatementService: IncomeStatementService,
    private readonly exportService: AccountingExportService,
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

  // Same underlying table and permission as `accounts` above, but the full tree
  // (including non-postable group accounts) instead of postable leaves only —
  // this one is for the chart of accounts screen, not the journal entry picker.
  @Get("chart-of-accounts")
  @RequirePermission("account", "read")
  async listChartOfAccounts(@CurrentUser() actor: CurrentUserPayload): Promise<ChartOfAccountEntry[]> {
    const accounts = await this.prisma.account.findMany({
      where: { companyId: actor.companyId, isActive: true },
      select: { id: true, code: true, name: true, type: true, isPostable: true, parentId: true },
      orderBy: { code: "asc" },
    });
    return accounts;
  }

  @Post("accounts")
  @RequirePermission("account", "create")
  async createAccount(
    @Body() dto: CreateAccountDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<ChartOfAccountEntry> {
    const duplicate = await this.prisma.account.findUnique({
      where: { companyId_code: { companyId: actor.companyId, code: dto.code } },
    });
    if (duplicate) throw new ConflictException("An account with this code already exists");

    if (dto.parentId) {
      const parent = await this.prisma.account.findUnique({ where: { id: dto.parentId } });
      if (!parent || parent.companyId !== actor.companyId) {
        throw new NotFoundException("Parent account not found");
      }
    }

    const id = newId();
    const account = await this.prisma.account.create({
      data: {
        id,
        companyId: actor.companyId,
        code: dto.code,
        name: dto.name,
        type: dto.type,
        normalBalance: normalBalanceFor(dto.type),
        isPostable: dto.isPostable,
        parentId: dto.parentId ?? null,
        createdBy: actor.id,
      },
      select: { id: true, code: true, name: true, type: true, isPostable: true, parentId: true },
    });
    return account;
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
  // accounts/fiscal-periods above. `from`/`to` are the one whitelisted filter
  // (entryDate range) — combining a where-clause filter with cursor pagination is
  // standard Prisma and works correctly: the cursor just anchors position within
  // whatever the filtered, ordered set is.
  @Get("journal-entries")
  @RequirePermission("journal_entry", "read")
  async listJournalEntries(
    @CurrentUser() actor: CurrentUserPayload,
    @Query() query: JournalEntriesQueryDto,
  ): Promise<JournalEntryListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "20", 10) || 20, 1), 100);
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        companyId: actor.companyId,
        ...(query.from || query.to
          ? {
              entryDate: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
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
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
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

  // docs/07-API-RULES.md §9: a single company's bounded report — not a batch or a
  // paginated export — so a synchronous response is fine; nothing here approaches
  // the "may exceed a few seconds" threshold that requires the 202+job-id pattern.
  @Get("trial-balance/export")
  @RequirePermission("trial_balance", "read")
  async exportTrialBalance(
    @CurrentUser() actor: CurrentUserPayload,
    @Query() query: ExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const file = await this.exportService.exportTrialBalance(actor.companyId, query.format, query.lang ?? "en");
    this.sendFile(res, file);
  }

  @Get("balance-sheet")
  @RequirePermission("balance_sheet", "read")
  balanceSheet(@CurrentUser() actor: CurrentUserPayload): Promise<BalanceSheetResult> {
    return this.balanceSheetService.compute(actor.companyId);
  }

  @Get("balance-sheet/export")
  @RequirePermission("balance_sheet", "read")
  async exportBalanceSheet(
    @CurrentUser() actor: CurrentUserPayload,
    @Query() query: ExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const file = await this.exportService.exportBalanceSheet(actor.companyId, query.format, query.lang ?? "en");
    this.sendFile(res, file);
  }

  @Get("income-statement")
  @RequirePermission("income_statement", "read")
  incomeStatement(
    @CurrentUser() actor: CurrentUserPayload,
    @Query() query: IncomeStatementQueryDto,
  ): Promise<IncomeStatementResult> {
    return this.incomeStatementService.compute(actor.companyId, new Date(query.from), new Date(query.to));
  }

  @Get("income-statement/export")
  @RequirePermission("income_statement", "read")
  async exportIncomeStatement(
    @CurrentUser() actor: CurrentUserPayload,
    @Query() query: IncomeStatementExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const file = await this.exportService.exportIncomeStatement(
      actor.companyId,
      query.format,
      query.lang ?? "en",
      new Date(query.from),
      new Date(query.to),
    );
    this.sendFile(res, file);
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

  // Sends the body directly via `res.send()` rather than returning it from the
  // handler — Nest's default response pipeline runs a non-string return value
  // (a Buffer included) through `res.json()`, which serializes a Buffer as
  // `{"type":"Buffer","data":[...]}` instead of writing raw bytes. Discovered by
  // actually downloading a PDF and checking its first bytes, not by reading Nest's
  // docs — the JSON output still reported `Content-Type: application/pdf`, which
  // made it look correct until the payload itself was inspected.
  private sendFile(res: Response, file: ExportedFile): void {
    res.header("Content-Type", file.contentType);
    res.header("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.content);
  }
}
