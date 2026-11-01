import { IsDateString, IsIn, IsOptional, IsString } from "class-validator";
import { Injectable, Controller, Get, NotFoundException, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  AgingService,
  PartyNotFoundError,
  PartyStatementService,
  type AgingReport,
  type InvoiceSide,
  type PartyStatement,
} from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { renderHtmlToPdf } from "../documents/pdf-renderer.js";
import { SUPPORTED_DOCUMENT_LANGUAGES, type SupportedDocumentLanguage } from "../i18n/server-i18n.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { agingToCsv, agingToPdfHtml, statementToCsv, statementToPdfHtml } from "./exports/receivables-exports.js";
import { localizedCompanyName } from "../common/company-name.js";

class AgingQueryDto {
  @IsIn(["SALES", "SUPPLIER"])
  side!: InvoiceSide;

  @IsDateString()
  asOf!: string;
}

class AgingExportQueryDto extends AgingQueryDto {
  @IsIn(["csv", "pdf"])
  format!: "csv" | "pdf";

  @IsOptional()
  @IsIn(SUPPORTED_DOCUMENT_LANGUAGES)
  lang?: SupportedDocumentLanguage;
}

class StatementQueryDto {
  @IsString()
  partyId!: string;

  @IsIn(["SALES", "SUPPLIER"])
  side!: InvoiceSide;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

class StatementExportQueryDto extends StatementQueryDto {
  @IsIn(["csv", "pdf"])
  format!: "csv" | "pdf";

  @IsOptional()
  @IsIn(SUPPORTED_DOCUMENT_LANGUAGES)
  lang?: SupportedDocumentLanguage;
}

interface ExportedFile {
  readonly content: string | Buffer;
  readonly contentType: string;
  readonly filename: string;
}

@Injectable()
export class ReceivablesExportService {
  constructor(private readonly prisma: PrismaService) {}

  private company(companyId: string) {
    return this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, nameAr: true, defaultCurrency: true } });
  }

  async aging(companyId: string, report: AgingReport, format: "csv" | "pdf", lang: SupportedDocumentLanguage): Promise<ExportedFile> {
    const base = report.side === "SALES" ? "receivables-ageing" : "payables-ageing";
    if (format === "csv") return { content: agingToCsv(report, lang), contentType: "text/csv; charset=utf-8", filename: `${base}.csv` };
    const company = await this.company(companyId);
    const html = await agingToPdfHtml({ report, language: lang, companyName: localizedCompanyName(company, lang), currency: company.defaultCurrency });
    return { content: await renderHtmlToPdf(html), contentType: "application/pdf", filename: `${base}.pdf` };
  }

  async statement(companyId: string, statement: PartyStatement, format: "csv" | "pdf", lang: SupportedDocumentLanguage): Promise<ExportedFile> {
    const base = `${statement.side === "SALES" ? "customer" : "supplier"}-statement`;
    if (format === "csv") return { content: statementToCsv(statement, lang), contentType: "text/csv; charset=utf-8", filename: `${base}.csv` };
    const company = await this.company(companyId);
    const html = await statementToPdfHtml({ statement, language: lang, companyName: localizedCompanyName(company, lang), currency: company.defaultCurrency });
    return { content: await renderHtmlToPdf(html), contentType: "application/pdf", filename: `${base}.pdf` };
  }
}

// Receivables / payables ageing and customer / supplier statements, with CSV and PDF export.
@Controller("v1/reports")
export class ReceivablesReportsController {
  constructor(
    private readonly aging: AgingService,
    private readonly statements: PartyStatementService,
    private readonly exports: ReceivablesExportService,
  ) {}

  @Get("aging")
  @RequirePermission("aging_report", "read")
  agingReport(@CurrentUser() actor: CurrentUserPayload, @Query() query: AgingQueryDto): Promise<AgingReport> {
    return this.aging.report(actor.companyId, query.side, new Date(query.asOf));
  }

  @Get("aging/export")
  @RequirePermission("aging_report", "read")
  async exportAging(@CurrentUser() actor: CurrentUserPayload, @Query() query: AgingExportQueryDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    const report = await this.aging.report(actor.companyId, query.side, new Date(query.asOf));
    send(res, await this.exports.aging(actor.companyId, report, query.format, query.lang ?? "en"));
  }

  @Get("party-statement")
  @RequirePermission("party_statement", "read")
  async statement(@CurrentUser() actor: CurrentUserPayload, @Query() query: StatementQueryDto): Promise<PartyStatement> {
    return this.loadStatement(actor.companyId, query);
  }

  @Get("party-statement/export")
  @RequirePermission("party_statement", "read")
  async exportStatement(@CurrentUser() actor: CurrentUserPayload, @Query() query: StatementExportQueryDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    const statement = await this.loadStatement(actor.companyId, query);
    send(res, await this.exports.statement(actor.companyId, statement, query.format, query.lang ?? "en"));
  }

  private async loadStatement(companyId: string, query: StatementQueryDto): Promise<PartyStatement> {
    try {
      return await this.statements.statement(companyId, query.partyId, query.side, new Date(query.from), new Date(query.to));
    } catch (error) {
      if (error instanceof PartyNotFoundError) throw new NotFoundException("Party not found");
      throw error;
    }
  }
}

function send(res: Response, file: ExportedFile): void {
  res.header("Content-Type", file.contentType);
  res.header("Content-Disposition", `attachment; filename="${file.filename}"`);
  res.send(file.content);
}
