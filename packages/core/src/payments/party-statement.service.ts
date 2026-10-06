import type { PrismaClient } from "@erp/db";
import { fromScaledBigInt, toScaledBigInt } from "../accounting/decimal-sum.util.js";
import type { InvoiceSide } from "./outstanding.js";

export type StatementEntryKind = "INVOICE" | "CREDIT_NOTE" | "RECEIPT" | "PAYMENT";

export interface PartyStatementLine {
  readonly kind: StatementEntryKind;
  readonly documentId: string;
  readonly number: string;
  readonly date: string;
  readonly reference: string | null;
  // Increases what is owed (an invoice) / decreases it (a payment, receipt or credit note).
  readonly charge: string;
  readonly settlement: string;
  readonly balance: string;
}

export interface PartyStatement {
  readonly side: InvoiceSide;
  readonly partyId: string;
  readonly partyName: string;
  readonly partyNameAr: string | null;
  readonly from: string;
  readonly to: string;
  readonly openingBalance: string;
  readonly totalCharges: string;
  readonly totalSettlements: string;
  // Positive: the party owes the company (a customer) / the company owes the party (a supplier).
  readonly closingBalance: string;
  readonly lines: readonly PartyStatementLine[];
}

export class PartyNotFoundError extends Error {
  constructor() {
    super("Party not found");
    this.name = "PartyNotFoundError";
  }
}

interface Row {
  kind: StatementEntryKind;
  id: string;
  number: string;
  doc_date: Date;
  reference: string | null;
  charge: string;
  settlement: string;
}

const day = (d: Date): string => d.toISOString().slice(0, 10);

// A customer's or supplier's statement: every invoice, credit note and payment in date order with a
// running balance of what is owed, and the balance carried in from before the period.
export class PartyStatementService {
  constructor(private readonly prisma: PrismaClient) {}

  async statement(companyId: string, partyId: string, side: InvoiceSide, from: Date, to: Date): Promise<PartyStatement> {
    const party = await this.prisma.party.findFirst({ where: { id: partyId, companyId }, select: { id: true, name: true, nameAr: true } });
    if (!party) throw new PartyNotFoundError();

    const rows =
      side === "SALES"
        ? await this.prisma.$queryRaw<Row[]>`
            SELECT kind, id, number, doc_date, reference, charge::text AS charge, settlement::text AS settlement FROM (
              SELECT CASE WHEN si.document_type = 'INVOICE' THEN 'INVOICE' ELSE 'CREDIT_NOTE' END AS kind,
                     si.id, si.number, si.invoice_date AS doc_date, NULL::text AS reference,
                     CASE WHEN si.document_type = 'INVOICE' THEN si.total_gross ELSE 0 END AS charge,
                     CASE WHEN si.document_type = 'CREDIT_NOTE' THEN si.total_gross ELSE 0 END AS settlement,
                     si.created_at
              FROM sales_invoices si WHERE si.company_id = ${companyId} AND si.customer_id = ${partyId} AND si.invoice_date <= ${to}::date
              UNION ALL
              SELECT 'RECEIPT', p.id, p.number, p.payment_date, p.reference, 0, p.amount, p.created_at
              FROM payments p WHERE p.company_id = ${companyId} AND p.party_id = ${partyId} AND p.direction = 'RECEIPT' AND p.payment_date <= ${to}::date
            ) x ORDER BY doc_date, created_at, number
          `
        : await this.prisma.$queryRaw<Row[]>`
            SELECT kind, id, number, doc_date, reference, charge::text AS charge, settlement::text AS settlement FROM (
              SELECT 'INVOICE' AS kind, si.id, si.number, si.invoice_date AS doc_date, si.supplier_invoice_number AS reference,
                     si.total_gross AS charge, 0 AS settlement, si.created_at
              FROM supplier_invoices si WHERE si.company_id = ${companyId} AND si.supplier_id = ${partyId} AND si.invoice_date <= ${to}::date
              UNION ALL
              SELECT 'PAYMENT', p.id, p.number, p.payment_date, p.reference, 0, p.amount, p.created_at
              FROM payments p WHERE p.company_id = ${companyId} AND p.party_id = ${partyId} AND p.direction = 'PAYMENT' AND p.payment_date <= ${to}::date
            ) x ORDER BY doc_date, created_at, number
          `;

    const fromDay = day(from);
    let opening = 0n;
    let running = 0n;
    let totalCharges = 0n;
    let totalSettlements = 0n;
    const lines: PartyStatementLine[] = [];
    for (const row of rows) {
      const charge = toScaledBigInt(row.charge);
      const settlement = toScaledBigInt(row.settlement);
      const date = day(row.doc_date);
      if (date < fromDay) {
        opening += charge - settlement;
        running = opening;
        continue;
      }
      running += charge - settlement;
      totalCharges += charge;
      totalSettlements += settlement;
      lines.push({
        kind: row.kind,
        documentId: row.id,
        number: row.number,
        date,
        reference: row.reference,
        charge: fromScaledBigInt(charge),
        settlement: fromScaledBigInt(settlement),
        balance: fromScaledBigInt(running),
      });
    }

    return {
      side,
      partyId: party.id,
      partyName: party.name,
      partyNameAr: party.nameAr,
      from: fromDay,
      to: day(to),
      openingBalance: fromScaledBigInt(opening),
      totalCharges: fromScaledBigInt(totalCharges),
      totalSettlements: fromScaledBigInt(totalSettlements),
      closingBalance: fromScaledBigInt(opening + totalCharges - totalSettlements),
      lines,
    };
  }
}
