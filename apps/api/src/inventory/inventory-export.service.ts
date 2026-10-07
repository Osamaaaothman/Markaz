import { Injectable } from "@nestjs/common";
import { StockLevelService, type StockLevelQuery } from "@erp/core";
import type { ExportedFile } from "../accounting/accounting-export.service.js";
import { renderHtmlToPdf } from "../documents/pdf-renderer.js";
import type { SupportedDocumentLanguage } from "../i18n/server-i18n.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { stockLevelsToCsv, stockLevelsToPdfHtml } from "./exports/stock-levels-export.js";

@Injectable()
export class InventoryExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockLevels: StockLevelService,
  ) {}

  async exportStockLevels(
    companyId: string,
    query: StockLevelQuery,
    format: "csv" | "pdf",
    lang: SupportedDocumentLanguage,
  ): Promise<ExportedFile> {
    const [entries, company] = await Promise.all([
      this.stockLevels.list(companyId, query),
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { name: true, defaultCurrency: true },
      }),
    ]);
    if (format === "csv") {
      return {
        content: stockLevelsToCsv(entries, company.defaultCurrency),
        contentType: "text/csv; charset=utf-8",
        filename: "stock-levels.csv",
      };
    }
    const html = await stockLevelsToPdfHtml({
      entries,
      language: lang,
      companyName: company.name,
      currency: company.defaultCurrency,
    });
    return { content: await renderHtmlToPdf(html), contentType: "application/pdf", filename: "stock-levels.pdf" };
  }
}
