// Wipes all demo BUSINESS data for a fresh re-seed, keeping the company/admin/roles,
// chart of accounts, account mappings, tax codes, fiscal year/periods and allowance types
// (setup, not demo data). Deletes children before parents so no FK (Restrict) blocks it.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  const company = await p.company.findFirstOrThrow();
  const companyId = company.id;
  const where = { companyId };

  const steps = [
    ["hrPaymentItem", () => p.hrPaymentItem.deleteMany({ where: { hrPayment: { companyId } } })],
    ["hrPayment", () => p.hrPayment.deleteMany({ where })],
    ["payrollRunLineAllowance", () => p.payrollRunLineAllowance.deleteMany({ where: { payrollRunLine: { payrollRun: { companyId } } } })],
    ["payrollRunLine", () => p.payrollRunLine.deleteMany({ where: { payrollRun: { companyId } } })],
    ["payrollRun", () => p.payrollRun.deleteMany({ where })],
    ["salaryAdvanceDeduction", () => p.salaryAdvanceDeduction.deleteMany({ where: { salaryAdvance: { companyId } } })],
    ["salaryAdvanceRepayment", () => p.salaryAdvanceRepayment.deleteMany({ where: { salaryAdvance: { companyId } } })],
    ["salaryAdvance", () => p.salaryAdvance.deleteMany({ where })],
    ["endOfServiceSettlement", () => p.endOfServiceSettlement.deleteMany({ where })],
    ["employeeAllowance", () => p.employeeAllowance.deleteMany({ where: { employee: { companyId } } })],
    ["employee", () => p.employee.deleteMany({ where })],
    ["attachment", () => p.attachment.deleteMany({ where })],
    ["paymentAllocation", () => p.paymentAllocation.deleteMany({ where: { payment: { companyId } } })],
    ["payment", () => p.payment.deleteMany({ where })],
    ["cashExpense", () => p.cashExpense.deleteMany({ where })],
    ["salesInvoiceLine", () => p.salesInvoiceLine.deleteMany({ where: { salesInvoice: { companyId } } })],
    ["salesInvoice", () => p.salesInvoice.deleteMany({ where })],
    // Quotation has an FK to the sales order it converted into — must go before SalesOrder.
    ["quotationLine", () => p.quotationLine.deleteMany({ where: { quotation: { companyId } } })],
    ["quotation", () => p.quotation.deleteMany({ where })],
    ["salesOrderLine", () => p.salesOrderLine.deleteMany({ where: { salesOrder: { companyId } } })],
    ["salesOrder", () => p.salesOrder.deleteMany({ where })],
    ["goodsReturnLine", () => p.goodsReturnLine.deleteMany({ where: { goodsReturn: { companyId } } })],
    ["goodsReturn", () => p.goodsReturn.deleteMany({ where })],
    ["supplierInvoiceLine", () => p.supplierInvoiceLine.deleteMany({ where: { supplierInvoice: { companyId } } })],
    ["supplierInvoice", () => p.supplierInvoice.deleteMany({ where })],
    // GoodsReceipt has an FK to the purchase order it was received against — before PurchaseOrder.
    ["goodsReceiptLine", () => p.goodsReceiptLine.deleteMany({ where: { goodsReceipt: { companyId } } })],
    ["goodsReceipt", () => p.goodsReceipt.deleteMany({ where })],
    // PurchaseRequest has an FK to the order it turned into — before PurchaseOrder.
    ["purchaseRequestLine", () => p.purchaseRequestLine.deleteMany({ where: { purchaseRequest: { companyId } } })],
    ["purchaseRequest", () => p.purchaseRequest.deleteMany({ where })],
    ["purchaseOrderLine", () => p.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { companyId } } })],
    ["purchaseOrder", () => p.purchaseOrder.deleteMany({ where })],
    ["approvalRequest", () => p.approvalRequest.deleteMany({ where })],
    ["stockCountLine", () => p.stockCountLine.deleteMany({ where: { stockCount: { companyId } } })],
    ["stockCount", () => p.stockCount.deleteMany({ where })],
    ["stockIssueLine", () => p.stockIssueLine.deleteMany({ where: { stockIssue: { companyId } } })],
    ["stockIssue", () => p.stockIssue.deleteMany({ where })],
    ["costLayer", () => p.costLayer.deleteMany({ where })],
    ["stockMovement", () => p.stockMovement.deleteMany({ where })],
    ["itemWarehouseStock", () => p.itemWarehouseStock.deleteMany({ where: { item: { companyId } } })],
    ["item", () => p.item.deleteMany({ where })],
    ["warehouse", () => p.warehouse.deleteMany({ where })],
    // journal_entry_lines_balance_check is a deferred-but-per-row constraint trigger that
    // requires >=2 lines per entry at all times, with no exception for the entry itself also
    // being deleted — so a normal DELETE can never zero it out. Disable it for just this
    // transaction (re-enabled immediately after) rather than leaving the books editable.
    [
      "journalEntry + journalEntryLine (trigger-safe)",
      () =>
        p.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`ALTER TABLE journal_entry_lines DISABLE TRIGGER journal_entry_lines_balance_check`);
          const lines = await tx.journalEntryLine.deleteMany({ where: { journalEntry: { companyId } } });
          const entries = await tx.journalEntry.deleteMany({ where });
          await tx.$executeRawUnsafe(`ALTER TABLE journal_entry_lines ENABLE TRIGGER journal_entry_lines_balance_check`);
          return { count: `${lines.count} lines, ${entries.count} entries` };
        }),
    ],
    ["account (party leaves)", () => p.account.deleteMany({ where: { companyId, partyId: { not: null } } })],
    ["party", () => p.party.deleteMany({ where })],
    ["outboxMessage", () => p.outboxMessage.deleteMany({ where }).catch(() => ({ count: 0 }))],
    ["auditLog", () => p.auditLog.deleteMany({ where })],
    // Safe to delete the counter for any ref/document type whose own rows were just wiped above
    // (PRT, EMP, WHS, ITM, and every fiscal-year-scoped document series) — they restart at 0
    // with nothing left to collide with. REF_ACC/REF_USR/REF_ROL are NOT safe to delete: Account,
    // User and Role rows are deliberately kept (chart of accounts, admin, roles), so deleting
    // their counters and letting them restart at 0 collides with refs already in use (this is
    // exactly the bug hit on 2026-11-12: a fresh "ACC-000001" clashed with the real one from the
    // original chart-of-accounts seed). Resync those three to their current max instead.
    [
      "documentNumberSeries (delete wiped types, resync kept ones)",
      async () => {
        const kept = [
          ["REF_ACC", "ACC-", p.account],
          ["REF_USR", "USR-", p.user],
          ["REF_ROL", "ROL-", p.role],
        ];
        const deleted = await p.documentNumberSeries.deleteMany({
          where: { companyId, documentType: { notIn: kept.map(([dt]) => dt) } },
        });
        for (const [documentType, prefix, model] of kept) {
          const rows = await model.findMany({ where: { companyId }, select: { ref: true } });
          const max = rows.reduce((m, r) => Math.max(m, Number(r.ref.slice(prefix.length)) || 0), 0);
          await p.documentNumberSeries.upsert({
            where: { companyId_documentType_fiscalYear: { companyId, documentType, fiscalYear: "ALL" } },
            create: { id: require("crypto").randomUUID(), companyId, documentType, fiscalYear: "ALL", prefix, padding: 6, lastNumber: max },
            update: { lastNumber: max },
          });
        }
        return { count: `${deleted.count} deleted, 3 resynced` };
      },
    ],
  ];

  for (const [name, fn] of steps) {
    const result = await fn();
    console.log(`${name}: deleted ${result.count}`);
  }
  console.log("\nWipe complete.");
}

main()
  .catch((e) => { console.error("WIPE FAILED:", e); process.exitCode = 1; })
  .finally(() => p.$disconnect());
