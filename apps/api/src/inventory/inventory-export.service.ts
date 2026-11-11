import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { StockLevelService, StockMovementService, StockMovementExportLimitError, type StockMovementQuery, type StockLevelQuery } from "@erp/core";
import type { ExportedFile } from "../accounting/accounting-export.service.js";
import { renderHtmlToPdf } from "../documents/pdf-renderer.js";
import type { SupportedDocumentLanguage } from "../i18n/server-i18n.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { stockLevelsToCsv, stockLevelsToPdfHtml } from "./exports/stock-levels-export.js";
import { localizedCompanyName } from "../common/company-name.js";
import { stockMovementsToCsv, stockMovementsToPdfHtml } from "./exports/stock-movements-export.js";

@Injectable()
export class InventoryExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockLevels: StockLevelService,
    private readonly movements: StockMovementService,
  ) {}

  async exportStockMovements(companyId: string, query: StockMovementQuery, format: "csv" | "pdf", lang: SupportedDocumentLanguage): Promise<ExportedFile> {
    if (query.from && query.to && query.from > query.to) throw new BadRequestException("Invalid date range");
    const entries = await this.movements.listForExport(companyId, query).catch((error: unknown) => {
      if (error instanceof StockMovementExportLimitError) throw new BadRequestException({ code: "STOCK_MOVEMENT_EXPORT_LIMIT" });
      throw error;
    });
    if (query.movementId && entries.length === 0) throw new NotFoundException("Movement not found");
    if (format === "csv") return { content: stockMovementsToCsv(entries), contentType: "text/csv; charset=utf-8", filename: "stock-movements.csv" };
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, nameAr: true, defaultCurrency: true } });
    const html = await stockMovementsToPdfHtml({ entries, language: lang, companyName: localizedCompanyName(company, lang), currency: company.defaultCurrency,
      from: query.from?.toISOString().slice(0, 10), to: query.to?.toISOString().slice(0, 10) });
    return { content: await renderHtmlToPdf(html, { landscape: true }), contentType: "application/pdf", filename: "stock-movements.pdf" };
  }

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
        select: { name: true, nameAr: true, defaultCurrency: true },
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
      companyName: localizedCompanyName(company, lang),
      currency: company.defaultCurrency,
    });
    return { content: await renderHtmlToPdf(html), contentType: "application/pdf", filename: "stock-levels.pdf" };
  }
}
