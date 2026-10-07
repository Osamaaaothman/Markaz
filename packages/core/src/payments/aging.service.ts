import { Prisma, type PrismaClient } from "@erp/db";
import { AccountMappingService, UnmappedAccountError } from "../inventory/account-mapping.service.js";
import { AGING_BUCKETS, bucketFor, daysPastDue, type AgingBucket } from "./aging.util.js";
import { loadOutstanding, type InvoiceSide } from "./outstanding.js";

export interface AgingPartyRow {
  readonly partyId: string;
  readonly partyName: string;
  readonly partyNameAr: string | null;
  readonly current: string;
  readonly days1to30: string;
  readonly days31to60: string;
  readonly days61to90: string;
  readonly over90: string;
  // Money received/paid that no invoice has been matched to yet (shown as a negative).
  readonly onAccount: string;
  readonly total: string;
}

export interface AgingReport {
  readonly side: InvoiceSide;
  readonly asOf: string;
  readonly parties: readonly AgingPartyRow[];
  readonly totals: Omit<AgingPartyRow, "partyId" | "partyName" | "partyNameAr">;
  // The control account's own balance on the same date, and the gap to the report: the ageing must
  // tie to the ledger (docs/14 M6 gate). null when the control account is not mapped yet.
  readonly ledgerBalance: string | null;
  readonly difference: string | null;
}

const zero = (): Record<AgingBucket | "onAccount", Prisma.Decimal> => ({
  current: new Prisma.Decimal(0),
  days1to30: new Prisma.Decimal(0),
  days31to60: new Prisma.Decimal(0),
  days61to90: new Prisma.Decimal(0),
  over90: new Prisma.Decimal(0),
  onAccount: new Prisma.Decimal(0),
});

function toRow(amounts: Record<AgingBucket | "onAccount", Prisma.Decimal>): Omit<AgingPartyRow, "partyId" | "partyName" | "partyNameAr"> {
  const total = AGING_BUCKETS.reduce((sum, b) => sum.plus(amounts[b]), new Prisma.Decimal(0)).plus(amounts.onAccount);
  return {
    current: amounts.current.toFixed(4),
    days1to30: amounts.days1to30.toFixed(4),
    days31to60: amounts.days31to60.toFixed(4),
    days61to90: amounts.days61to90.toFixed(4),
    over90: amounts.over90.toFixed(4),
    onAccount: amounts.onAccount.toFixed(4),
    total: total.toFixed(4),
  };
}

// Receivables (customers) or payables (suppliers), by how overdue each open invoice is, as of a date.
// Everything is rolled back to that date: an invoice, credit note or payment dated after it does not
// count. An invoice is overdue from its due date (its own date when none was given).
export class AgingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly accountMappings: AccountMappingService,
  ) {}

  async report(companyId: string, side: InvoiceSide, asOf: Date): Promise<AgingReport> {
    const asOfDay = asOf.toISOString().slice(0, 10);
    const open = await loadOutstanding(this.prisma, companyId, side, { asOf });

    const byParty = new Map<string, Record<AgingBucket | "onAccount", Prisma.Decimal>>();
    const slot = (partyId: string): Record<AgingBucket | "onAccount", Prisma.Decimal> => {
      let row = byParty.get(partyId);
      if (!row) byParty.set(partyId, (row = zero()));
      return row;
    };
    for (const invoice of open) {
      if (invoice.outstanding.isZero()) continue;
      const bucket = bucketFor(daysPastDue(invoice.dueDate ?? invoice.invoiceDate, asOfDay));
      const row = slot(invoice.partyId);
      row[bucket] = row[bucket].plus(invoice.outstanding);
    }

    // On account: payments dated on or before the date, less what they were allocated to.
    const direction = side === "SALES" ? "RECEIPT" : "PAYMENT";
    const unallocated = await this.prisma.$queryRaw<{ party_id: string; unallocated: string }[]>`
      SELECT p.party_id,
             SUM(p.amount - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0))::text AS unallocated
      FROM payments p
      WHERE p.company_id = ${companyId} AND p.direction = ${direction} AND p.payment_date <= ${asOf}::date
      GROUP BY p.party_id
    `;
    for (const u of unallocated) {
      const amount = new Prisma.Decimal(u.unallocated);
      if (!amount.isZero()) slot(u.party_id).onAccount = amount.negated();
    }

    const parties = await this.prisma.party.findMany({ where: { companyId, id: { in: [...byParty.keys()] } }, select: { id: true, name: true, nameAr: true } });
    const partyById = new Map(parties.map((p) => [p.id, p]));

    const rows: AgingPartyRow[] = [...byParty.entries()]
      .map(([partyId, amounts]) => ({
        partyId,
        partyName: partyById.get(partyId)?.name ?? partyId,
        partyNameAr: partyById.get(partyId)?.nameAr ?? null,
        ...toRow(amounts),
      }))
      .sort((a, b) => a.partyName.localeCompare(b.partyName));

    const totals = zero();
    for (const amounts of byParty.values()) {
      for (const key of [...AGING_BUCKETS, "onAccount"] as const) totals[key] = totals[key].plus(amounts[key]);
    }
    const totalRow = toRow(totals);

    const ledgerBalance = await this.ledgerBalance(companyId, side, asOf);
    return {
      side,
      asOf: asOfDay,
      parties: rows,
      totals: totalRow,
      ledgerBalance: ledgerBalance?.toFixed(4) ?? null,
      difference: ledgerBalance ? new Prisma.Decimal(totalRow.total).minus(ledgerBalance).toFixed(4) : null,
    };
  }

  // The control account's balance in its natural direction: receivable is debit-normal, payable credit-normal.
  private async ledgerBalance(companyId: string, side: InvoiceSide, asOf: Date): Promise<Prisma.Decimal | null> {
    let accountId: string;
    try {
      accountId = await this.accountMappings.resolve(this.prisma, companyId, side === "SALES" ? "ACCOUNTS_RECEIVABLE" : "ACCOUNTS_PAYABLE");
    } catch (error) {
      if (error instanceof UnmappedAccountError) return null;
      throw error;
    }
    const rows = await this.prisma.$queryRaw<{ debit: string; credit: string }[]>`
      SELECT COALESCE(SUM(l.base_debit), 0)::text AS debit, COALESCE(SUM(l.base_credit), 0)::text AS credit
      FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.journal_entry_id
      WHERE l.account_id = ${accountId} AND je.company_id = ${companyId} AND je.entry_date <= ${asOf}::date
    `;
    const debit = new Prisma.Decimal(rows[0]?.debit ?? "0");
    const credit = new Prisma.Decimal(rows[0]?.credit ?? "0");
    return side === "SALES" ? debit.minus(credit) : credit.minus(debit);
  }
}
