import { Injectable } from "@nestjs/common";
import { toCsvDocument } from "../common/csv.util.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { ExportedFile } from "./accounting-export.service.js";

export const JOURNAL_EXPORT_LIMIT = 50_000;

interface Row {
  number: string;
  entry_date: Date;
  source_type: string;
  account_code: string;
  account_name: string;
  line_description: string | null;
  debit: string;
  credit: string;
  currency: string;
}

// Every posted journal line in a date range as one CSV row, for an accountant to filter, pivot or
// import. One row per line, entry by entry in posting order; amounts are the transaction-currency
// figures as posted.
@Injectable()
export class JournalExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportCsv(companyId: string, from: Date | null, to: Date | null): Promise<ExportedFile> {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT je.number, je.entry_date, je.source_document_type AS source_type,
             a.code AS account_code, a.name AS account_name, l.description AS line_description,
             l.debit::text AS debit, l.credit::text AS credit, je.currency
      FROM journal_entry_lines l
      JOIN journal_entries je ON je.id = l.journal_entry_id
      JOIN accounts a ON a.id = l.account_id
      WHERE je.company_id = ${companyId}
        AND (${from}::date IS NULL OR je.entry_date >= ${from}::date)
        AND (${to}::date IS NULL OR je.entry_date <= ${to}::date)
      ORDER BY je.entry_date, je.created_at, l.line_number
      LIMIT ${JOURNAL_EXPORT_LIMIT}
    `;
    const table: string[][] = [["Entry", "Date", "Source", "Account Code", "Account", "Description", "Debit", "Credit", "Currency"]];
    for (const r of rows) {
      table.push([r.number, r.entry_date.toISOString().slice(0, 10), r.source_type, r.account_code, r.account_name, r.line_description ?? "", r.debit, r.credit, r.currency]);
    }
    return { content: toCsvDocument(table), contentType: "text/csv; charset=utf-8", filename: "journal-lines.csv" };
  }
}
