import { Injectable } from "@nestjs/common";
import { GeneralLedgerService, type LedgerStatement } from "@erp/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { renderHtmlToPdf } from "../documents/pdf-renderer.js";
import type { SupportedDocumentLanguage } from "../i18n/server-i18n.js";
import type { ExportedFile } from "./accounting-export.service.js";
import { generalLedgerToCsv, generalLedgerToPdfHtml } from "./exports/general-ledger-export.js";

@Injectable()
export class LedgerExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: GeneralLedgerService,
  ) {}

  async export(
    companyId: string,
    accountId: string,
    from: Date,
    to: Date,
    format: "csv" | "pdf",
    lang: SupportedDocumentLanguage,
  ): Promise<ExportedFile> {
    const [computed, company] = await Promise.all([
      this.ledger.statement(companyId, accountId, from, to),
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { name: true, defaultCurrency: true },
      }),
    ]);
    const statement = await this.localizeName(companyId, lang, computed);
    const base = `ledger-${statement.accountCode}`;
    if (format === "csv") {
      return { content: generalLedgerToCsv(statement), contentType: "text/csv; charset=utf-8", filename: `${base}.csv` };
    }
    const html = await generalLedgerToPdfHtml({
      statement,
      language: lang,
      companyName: company.name,
      currency: company.defaultCurrency,
    });
    return { content: await renderHtmlToPdf(html), contentType: "application/pdf", filename: `${base}.pdf` };
  }

  private async localizeName(
    companyId: string,
    lang: SupportedDocumentLanguage,
    statement: LedgerStatement,
  ): Promise<LedgerStatement> {
    if (lang !== "ar") return statement;
    const account = await this.prisma.account.findFirst({
      where: { companyId, id: statement.accountId },
      select: { nameAr: true },
    });
    return account?.nameAr ? { ...statement, accountName: account.nameAr } : statement;
  }
}
