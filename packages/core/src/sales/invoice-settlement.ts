import { Prisma } from "@erp/db";

export type InvoiceSettlementStatus = "OPEN" | "PARTIAL" | "SETTLED" | "OVERDUE" | "RECORDED";

/** A read-only label for the same outstanding balance used by receipts and ageing.
 * Settled includes credit notes; it does not assert that the whole amount was paid in cash. */
export function invoiceSettlementStatus(
  documentType: string,
  gross: Prisma.Decimal,
  outstanding: Prisma.Decimal | null,
  dueDate: string | null,
  today: string,
): InvoiceSettlementStatus {
  if (documentType !== "INVOICE") return "RECORDED";
  if (outstanding === null) return "OPEN";
  if (outstanding.lte(0)) return "SETTLED";
  if (dueDate !== null && dueDate < today) return "OVERDUE";
  return outstanding.lt(gross) ? "PARTIAL" : "OPEN";
}
