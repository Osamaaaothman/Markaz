import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { IAccountingEngine, PostingResult } from "@erp/core";
import { TrialBalanceService, type TrialBalanceResult } from "@erp/core";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { ACCOUNTING_ENGINE } from "./accounting.tokens.js";
import { PostJournalEntryDto } from "./dto/post-journal-entry.dto.js";
import { ReverseJournalEntryDto } from "./dto/reverse-journal-entry.dto.js";

@Controller("v1")
export class AccountingController {
  constructor(
    @Inject(ACCOUNTING_ENGINE) private readonly engine: IAccountingEngine,
    private readonly trialBalanceService: TrialBalanceService,
  ) {}

  // docs/05-ACCOUNTING-INTEGRITY-RULES.md §7: "Trial balance — must always be zero.
  // Expose it in development as a health check."
  @Get("trial-balance")
  @RequirePermission("trial_balance", "read")
  trialBalance(@CurrentUser() actor: CurrentUserPayload): Promise<TrialBalanceResult> {
    return this.trialBalanceService.compute(actor.companyId);
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
