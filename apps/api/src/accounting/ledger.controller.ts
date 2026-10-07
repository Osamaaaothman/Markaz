import { Controller, Get, NotFoundException, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { GeneralLedgerService, LedgerAccountNotFoundError, type LedgerStatement } from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { LedgerExportService } from "./ledger-export.service.js";
import { LedgerExportQueryDto, LedgerQueryDto } from "./dto/ledger-query.dto.js";

// Account statement (general ledger). Reads the same posted journal lines as the trial balance,
// so it needs the same right as the journal itself.
@Controller("v1")
export class LedgerController {
  constructor(
    private readonly ledger: GeneralLedgerService,
    private readonly exports: LedgerExportService,
  ) {}

  @Get("ledger")
  @RequirePermission("journal_entry", "read")
  async statement(@CurrentUser() actor: CurrentUserPayload, @Query() query: LedgerQueryDto): Promise<LedgerStatement> {
    try {
      return await this.ledger.statement(actor.companyId, query.accountId, new Date(query.from), new Date(query.to));
    } catch (error) {
      if (error instanceof LedgerAccountNotFoundError) throw new NotFoundException("Account not found");
      throw error;
    }
  }

  @Get("ledger/export")
  @RequirePermission("journal_entry", "read")
  async export(
    @CurrentUser() actor: CurrentUserPayload,
    @Query() query: LedgerExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    try {
      const file = await this.exports.export(
        actor.companyId,
        query.accountId,
        new Date(query.from),
        new Date(query.to),
        query.format,
        query.lang ?? "en",
      );
      res.header("Content-Type", file.contentType);
      res.header("Content-Disposition", `attachment; filename="${file.filename}"`);
      res.send(file.content);
    } catch (error) {
      if (error instanceof LedgerAccountNotFoundError) throw new NotFoundException("Account not found");
      throw error;
    }
  }
}
