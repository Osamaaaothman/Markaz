import type { PrismaClient } from "@erp/db";
import type { IPermissionService } from "../contracts.js";

export interface AuditReference {
  readonly entityType: string;
  readonly id: string;
  readonly number: string;
  readonly kind: string;
}
interface AuditRow {
  entityType: string;
  entityId: string;
  beforeJson: unknown;
  afterJson: unknown;
}
const kinds: Record<string, string> = {
  SalesInvoice: "sales_invoice",
  SupplierInvoice: "supplier_invoice",
  PurchaseOrder: "purchase_order",
  PurchaseRequest: "purchase_request",
  GoodsReceipt: "goods_receipt",
  GoodsReturn: "goods_return",
  Quotation: "quotation",
  SalesOrder: "sales_order",
  Payment: "payment",
  JournalEntry: "journal_entry",
  StockIssue: "stock_issue",
  StockCount: "stock_count",
  CashExpense: "cash_expense",
  HrPayment: "hr_payment",
  PayrollRun: "payroll_run",
};
const foreignTypes: Record<string, string> = {
  salesInvoiceId: "SalesInvoice",
  supplierInvoiceId: "SupplierInvoice",
  purchaseOrderId: "PurchaseOrder",
  purchaseRequestId: "PurchaseRequest",
  goodsReceiptId: "GoodsReceipt",
  goodsReturnId: "GoodsReturn",
  quotationId: "Quotation",
  salesOrderId: "SalesOrder",
  paymentId: "Payment",
  reversalId: "Payment",
  journalEntryId: "JournalEntry",
};
export const referenceKey = (type: string, id: string): string => `${type}:${id}`;

// Only explicit document-id fields are followed. No untrusted URL or arbitrary model access.
export function auditReferences(row: AuditRow): { entityType: string; id: string }[] {
  const refs = [{ entityType: row.entityType, id: row.entityId }];
  for (const snapshot of [row.beforeJson, row.afterJson]) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) continue;
    for (const [field, id] of Object.entries(snapshot)) {
      const type =
        field === "originalInvoiceId" &&
        ["SalesInvoice", "SupplierInvoice"].includes(row.entityType)
          ? row.entityType
          : foreignTypes[field];
      if (type && typeof id === "string" && id) refs.push({ entityType: type, id });
    }
  }
  return [...new Map(refs.map((r) => [referenceKey(r.entityType, r.id), r])).values()];
}

/** One query per visible document kind, never one per log row. Every lookup is company scoped. */
export async function resolveAuditReferences(
  prisma: PrismaClient,
  permissions: IPermissionService,
  companyId: string,
  actorId: string,
  rows: readonly AuditRow[],
): Promise<Map<string, AuditReference>> {
  const grouped = new Map<string, Set<string>>();
  for (const row of rows)
    for (const ref of auditReferences(row)) {
      if (!kinds[ref.entityType]) continue;
      const ids = grouped.get(ref.entityType) ?? new Set<string>();
      ids.add(ref.id);
      grouped.set(ref.entityType, ids);
    }
  const references = new Map<string, AuditReference>();
  await Promise.all(
    [...grouped].map(async ([entityType, ids]) => {
      const kind = kinds[entityType]!;
      if (!(await permissions.can(actorId, "read", kind, companyId))) return;
      const where = { companyId, id: { in: [...ids] } },
        select = { id: true, number: true } as const;
      let documents: { id: string; number: string }[] = [];
      switch (entityType) {
        case "SalesInvoice":
          documents = await prisma.salesInvoice.findMany({ where, select });
          break;
        case "SupplierInvoice":
          documents = await prisma.supplierInvoice.findMany({ where, select });
          break;
        case "PurchaseOrder":
          documents = await prisma.purchaseOrder.findMany({ where, select });
          break;
        case "PurchaseRequest":
          documents = await prisma.purchaseRequest.findMany({ where, select });
          break;
        case "GoodsReceipt":
          documents = await prisma.goodsReceipt.findMany({ where, select });
          break;
        case "GoodsReturn":
          documents = await prisma.goodsReturn.findMany({ where, select });
          break;
        case "Quotation":
          documents = await prisma.quotation.findMany({ where, select });
          break;
        case "SalesOrder":
          documents = await prisma.salesOrder.findMany({ where, select });
          break;
        case "Payment":
          documents = await prisma.payment.findMany({ where, select });
          break;
        case "JournalEntry":
          documents = await prisma.journalEntry.findMany({ where, select });
          break;
        case "StockIssue":
          documents = await prisma.stockIssue.findMany({ where, select });
          break;
        case "StockCount":
          documents = await prisma.stockCount.findMany({ where, select });
          break;
        case "CashExpense":
          documents = await prisma.cashExpense.findMany({ where, select });
          break;
        case "HrPayment":
          documents = await prisma.hrPayment.findMany({ where, select });
          break;
        case "PayrollRun":
          documents = await prisma.payrollRun.findMany({ where, select });
          break;
      }
      for (const doc of documents)
        references.set(referenceKey(entityType, doc.id), { ...doc, entityType, kind });
    }),
  );
  return references;
}
