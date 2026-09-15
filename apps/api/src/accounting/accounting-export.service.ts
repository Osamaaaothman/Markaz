import { Injectable } from "@nestjs/common";
import { BalanceSheetService, IncomeStatementService, TrialBalanceService } from "@erp/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { renderHtmlToPdf } from "../documents/pdf-renderer.js";
import type { SupportedDocumentLanguage } from "../i18n/server-i18n.js";
import type { ExportFormat } from "./dto/export-query.dto.js";
import { balanceSheetToCsv, balanceSheetToPdfHtml } from "./exports/balance-sheet-export.js";
import { incomeStatementToCsv, incomeStatementToPdfHtml } from "./exports/income-statement-export.js";
import { trialBalanceToCsv, trialBalanceToPdfHtml } from "./exports/trial-balance-export.js";

export interface ExportedFile {
  readonly content: string | Buffer;
  readonly contentType: string;
  readonly filename: string;
}

// Keeps AccountingController's export endpoints to one line each
// (docs/07-API-RULES.md §2: "controllers are thin") — this is where the
// report-service call, company lookup, and CSV/PDF branching actually live.
@Injectable()
export class AccountingExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trialBalanceService: TrialBalanceService,
    private readonly balanceSheetService: BalanceSheetService,
    private readonly incomeStatementService: IncomeStatementService,
  ) {}

  async exportTrialBalance(
    companyId: string,
    format: ExportFormat,
    lang: SupportedDocumentLanguage,
  ): Promise<ExportedFile> {
    const [result, company] = await Promise.all([
      this.trialBalanceService.compute(companyId),
      this.getCompany(companyId),
    ]);

    if (format === "csv") {
      return { content: trialBalanceToCsv(result), contentType: "text/csv; charset=utf-8", filename: "trial-balance.csv" };
    }
    const html = await trialBalanceToPdfHtml({ result, language: lang, companyName: company.name, currency: company.defaultCurrency });
    return { content: await renderHtmlToPdf(html), contentType: "application/pdf", filename: "trial-balance.pdf" };
  }

  async exportBalanceSheet(
    companyId: string,
    format: ExportFormat,
    lang: SupportedDocumentLanguage,
  ): Promise<ExportedFile> {
    const [result, company] = await Promise.all([
      this.balanceSheetService.compute(companyId),
      this.getCompany(companyId),
    ]);

    if (format === "csv") {
      return { content: balanceSheetToCsv(result), contentType: "text/csv; charset=utf-8", filename: "balance-sheet.csv" };
    }
    const html = await balanceSheetToPdfHtml({ result, language: lang, companyName: company.name, currency: company.defaultCurrency });
    return { content: await renderHtmlToPdf(html), contentType: "application/pdf", filename: "balance-sheet.pdf" };
  }

  async exportIncomeStatement(
    companyId: string,
    format: ExportFormat,
    lang: SupportedDocumentLanguage,
    from: Date,
    to: Date,
  ): Promise<ExportedFile> {
    const [result, company] = await Promise.all([
      this.incomeStatementService.compute(companyId, from, to),
      this.getCompany(companyId),
    ]);

    if (format === "csv") {
      return {
        content: incomeStatementToCsv(result),
        contentType: "text/csv; charset=utf-8",
        filename: "income-statement.csv",
      };
    }
    const html = await incomeStatementToPdfHtml({
      result,
      language: lang,
      companyName: company.name,
      currency: company.defaultCurrency,
    });
    return { content: await renderHtmlToPdf(html), contentType: "application/pdf", filename: "income-statement.pdf" };
  }

  private async getCompany(companyId: string): Promise<{ name: string; defaultCurrency: string }> {
    return this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true, defaultCurrency: true },
    });
  }
}
