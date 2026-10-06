import { Prisma } from "@erp/db";
import type { TransactionClient } from "../contracts.js";

export type InvoiceSide = "SALES" | "SUPPLIER";

export interface OutstandingInvoice {
  readonly id: string;
  readonly number: string;
  readonly partyId: string;
  readonly invoiceDate: string;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly gross: Prisma.Decimal;
  // gross minus what payments (and, for sales, credit notes) dated on or before the cut-off have settled.
  readonly outstanding: Prisma.Decimal;
}

interface Row {
  id: string;
  number: string;
  party_id: string;
  invoice_date: Date;
  due_date: Date | null;
  currency: string;
  gross: string;
  outstanding: string;
}

const FAR_FUTURE = new Date(Date.UTC(9999, 11, 31));
const day = (d: Date): string => d.toISOString().slice(0, 10);

// One place that knows what "still owed on an invoice" means, so payments, the open-items list and
// the ageing reports can never disagree (the ageing report must tie to the ledger — docs/14 M6 gate).
//   sales invoice  : gross - allocated receipts - credit notes raised against it
//   supplier invoice: gross - allocated payments
// `asOf` rolls the position back to a past date: only documents dated on or before it count.
// Pass `ids` to look at specific invoices, `partyId` for one party, neither for all of them.
export async function loadOutstanding(
  tx: TransactionClient,
  companyId: string,
  side: InvoiceSide,
  options: { readonly ids?: readonly string[]; readonly partyId?: string; readonly asOf?: Date } = {},
): Promise<OutstandingInvoice[]> {
  const asOf = options.asOf ?? FAR_FUTURE;
  const ids = options.ids ? [...options.ids] : null;
  const partyId = options.partyId ?? null;

  const rows =
    side === "SALES"
      ? await tx.$queryRaw<Row[]>`
          SELECT si.id, si.number, si.customer_id AS party_id, si.invoice_date, si.due_date, si.currency,
                 si.total_gross::text AS gross,
                 (si.total_gross
                   - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
                               WHERE a.sales_invoice_id = si.id AND p.payment_date <= ${asOf}::date), 0)
                   - COALESCE((SELECT SUM(cn.total_gross) FROM sales_invoices cn
                               WHERE cn.original_invoice_id = si.id AND cn.invoice_date <= ${asOf}::date), 0))::text AS outstanding
          FROM sales_invoices si
          WHERE si.company_id = ${companyId} AND si.document_type = 'INVOICE' AND si.invoice_date <= ${asOf}::date
            AND (${ids}::text[] IS NULL OR si.id = ANY(${ids}::text[]))
            AND (${partyId}::text IS NULL OR si.customer_id = ${partyId})
          ORDER BY si.invoice_date, si.number
        `
      : await tx.$queryRaw<Row[]>`
          SELECT si.id, si.number, si.supplier_id AS party_id, si.invoice_date, si.due_date, si.currency,
                 si.total_gross::text AS gross,
                 (si.total_gross
                   - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
                               WHERE a.supplier_invoice_id = si.id AND p.payment_date <= ${asOf}::date), 0))::text AS outstanding
          FROM supplier_invoices si
          WHERE si.company_id = ${companyId} AND si.invoice_date <= ${asOf}::date
            AND (${ids}::text[] IS NULL OR si.id = ANY(${ids}::text[]))
            AND (${partyId}::text IS NULL OR si.supplier_id = ${partyId})
          ORDER BY si.invoice_date, si.number
        `;

  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    partyId: r.party_id,
    invoiceDate: day(r.invoice_date),
    dueDate: r.due_date ? day(r.due_date) : null,
    currency: r.currency,
    gross: new Prisma.Decimal(r.gross),
    outstanding: new Prisma.Decimal(r.outstanding),
  }));
}
