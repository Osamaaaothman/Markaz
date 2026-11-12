import type { PrismaClient } from "@erp/db";

// Explicit business fields only: no customer credentials, addresses or tax-signing material.
// Called when recording a new posting event; older audit rows are never backfilled.
export async function invoiceAuditSnapshot(
  prisma: PrismaClient,
  companyId: string,
  id: string,
  kind: "sales" | "supplier",
): Promise<Record<string, unknown>> {
  const where = { companyId, id };
  const select = {
    number: true,
    documentType: true,
    originalInvoiceId: true,
    invoiceDate: true,
    dueDate: true,
    currency: true,
    totalNet: true,
    totalTax: true,
    totalGross: true,
    notes: true,
    journalEntryId: true,
    lines: {
      orderBy: { lineNumber: "asc" as const },
      select: {
        lineNumber: true,
        description: true,
        quantity: true,
        unitPrice: true,
        netAmount: true,
        taxRate: true,
        taxAmount: true,
      },
    },
  } as const;
  const partySelect = { select: { name: true, nameAr: true } } as const;
  const row =
    kind === "sales"
      ? await prisma.salesInvoice.findFirst({
          where,
          select: { ...select, customer: partySelect, customerId: true, salesOrderId: true },
        })
      : await prisma.supplierInvoice.findFirst({
          where,
          select: {
            ...select,
            supplier: partySelect,
            supplierId: true,
            purchaseOrderId: true,
            supplierInvoiceNumber: true,
          },
        });
  if (!row) throw new Error("Posted invoice missing while recording its audit snapshot");
  return {
    number: row.number,
    documentType: row.documentType,
    originalInvoiceId: row.originalInvoiceId,
    invoiceDate: row.invoiceDate.toISOString().slice(0, 10),
    dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null,
    currency: row.currency,
    totalNet: row.totalNet.toFixed(4),
    totalTax: row.totalTax.toFixed(4),
    totalGross: row.totalGross.toFixed(4),
    notes: row.notes,
    journalEntryId: row.journalEntryId,
    ...("customer" in row
      ? {
          customerId: row.customerId,
          customerName: row.customer.name,
          customerNameAr: row.customer.nameAr,
          salesOrderId: row.salesOrderId,
        }
      : {
          supplierId: row.supplierId,
          supplierName: row.supplier.name,
          supplierNameAr: row.supplier.nameAr,
          purchaseOrderId: row.purchaseOrderId,
          supplierInvoiceNumber: row.supplierInvoiceNumber,
        }),
    lines: row.lines.map((line) => ({
      lineNumber: line.lineNumber,
      description: line.description,
      quantity: line.quantity.toFixed(4),
      unitPrice: line.unitPrice.toFixed(4),
      netAmount: line.netAmount.toFixed(4),
      taxRate: line.taxRate.toFixed(4),
      taxAmount: line.taxAmount.toFixed(4),
    })),
  };
}
