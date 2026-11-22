// Runs every AI assistant action end to end through the real, built app (controllers, services,
// PostgreSQL) against the local demo company. It WRITES real documents, so it refuses anything but a
// local database. Usage (from apps/api, after `npm run build`):
//   node --env-file=../../.env scripts/ai-actions-live.cjs      (with @db: / redis: hosts pointing at localhost)
require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");
const { PrismaClient } = require("@prisma/client");

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Refusing: DATABASE_URL must point at a local database.");
  process.exit(1);
}

(async () => {
  const { AppModule } = require("../dist/app.module.js");
  const { AI_TOOLS } = require("../dist/ai/ai.tokens.js");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
  const db = new PrismaClient();
  const tools = new Map(app.get(AI_TOOLS).filter((t) => t.kind === "write").map((t) => [t.name, t]));
  const results = {};

  // The demo company is the seed admin's company.
  const seedUser = await db.user.findFirstOrThrow({ where: { email: process.env.SEED_ADMIN_EMAIL }, select: { id: true, companyId: true } });
  const companyId = seedUser.companyId;
  const admin = { userId: seedUser.id };
  const id = () => require("node:crypto").randomUUID();
  const ctx = { actor: { userId: admin.userId, companyId }, locale: "ar", conversationId: `live-${id()}`, correlationId: id(), can: async () => true };

  const step = async (name, args) => {
    const tool = tools.get(name);
    if (!tool) { results[name] = "FAILED no such tool"; return null; }
    let preview;
    ctx.correlationId = id(); // each step is its own decision, as in the app
    try {
      const input = tool.input.parse(args);
      preview = await tool.preview(ctx, input);
      const r = await tool.execute(ctx, input);
      results[name] = `ok ${JSON.stringify(r.data)}`;
      return r.data;
    } catch (error) {
      results[name] = `FAILED ${error.code ?? ""} ${String(error.message).slice(0, 200)} | warnings=${JSON.stringify(preview?.warningKeys ?? [])}`;
      return null;
    }
  };

  const customer = await db.party.findFirstOrThrow({ where: { companyId, kind: { in: ["CUSTOMER", "CUSTOMER_SUPPLIER"] }, isActive: true } });
  const supplier = await db.party.findFirstOrThrow({ where: { companyId, kind: { in: ["SUPPLIER", "CUSTOMER_SUPPLIER"] }, isActive: true } });
  // An item with stock on hand (signed movement quantities summed per item and warehouse).
  const balances = await db.stockMovement.groupBy({ by: ["itemId", "warehouseId"], where: { companyId }, _sum: { quantity: true } });
  const onHand = balances.find((b) => b._sum.quantity && b._sum.quantity.gt(10));
  if (!onHand) throw new Error("No item with stock in the demo company");
  const itemCode = (await db.item.findUniqueOrThrow({ where: { id: onHand.itemId } })).code;
  const warehouseCode = (await db.warehouse.findUniqueOrThrow({ where: { id: onHand.warehouseId } })).code;
  // The cash/bank account the company's own receipts use.
  const usedCash = await db.payment.findFirstOrThrow({ where: { companyId }, orderBy: { createdAt: "desc" }, select: { cashAccountId: true } });
  const cash = await db.account.findUniqueOrThrow({ where: { id: usedCash.cashAccountId } });
  const expense = await db.account.findFirstOrThrow({ where: { companyId, isPostable: true, isActive: true, type: "EXPENSE" } });
  const salesLine = { itemCode, quantity: "1", unitPrice: "100.00" };
  console.log(`company=${companyId} item=${itemCode} warehouse=${warehouseCode} cash=${cash.code} expense=${expense.code}`);

  // 1. Sales lifecycle
  const q1 = await step("sales_createQuotation", { customerId: customer.id, lines: [salesLine] });
  if (q1) await step("sales_rejectQuotation", { quotation: q1.number });
  results.q1 = results.sales_createQuotation;
  const q2 = await step("sales_createQuotation", { customerId: customer.id, lines: [salesLine] });
  if (q2) await step("sales_cancelQuotation", { quotation: q2.number });
  const q3 = await step("sales_createQuotation", { customerId: customer.id, lines: [salesLine] });
  if (q3) await step("sales_convertQuotation", { quotation: q3.number });
  const so = await step("sales_createOrder", { customerId: customer.id, lines: [salesLine] });
  if (so) await step("sales_createDeliveryNote", { order: so.number });
  const so2 = await step("sales_createOrder", { customerId: customer.id, lines: [salesLine] });
  if (so2) await step("sales_cancelOrder", { order: so2.number });
  const inv = await step("sales_createInvoice", { customerId: customer.id, warehouseCode, lines: [{ itemCode, quantity: "2", unitPrice: "150.00" }] });
  if (inv) {
    await step("sales_createCreditNote", { invoice: inv.number, notes: "Returned one", lines: [{ itemCode, quantity: "1" }] });
    await step("sales_createDebitNote", { invoice: inv.number, notes: "Extra charge", lines: [{ itemCode, quantity: "1", unitPrice: "10.00" }] });
    // 2. Payments
    const rc = await step("payments_customerReceipt", { partyId: customer.id, amount: "50.00", cashAccountCode: cash.code, method: "BANK_TRANSFER", allocations: [{ invoice: inv.number, amount: "50.00" }] });
    if (rc) await step("payments_reverse", { payment: rc.number });
  }
  await step("payments_supplierPayment", { partyId: supplier.id, amount: "25.00", cashAccountCode: cash.code, method: "BANK_TRANSFER" });

  // 3. Purchasing
  await step("purchasing_createRequest", { warehouseCode, lines: [{ itemCode, quantity: "3" }] });
  const po = await step("purchasing_createOrder", { supplierId: supplier.id, warehouseCode, lines: [{ itemCode, quantity: "2", unitPrice: "40.00" }] });
  if (po) {
    // Only an order the approval rules hold can be approved; without a rule it is approved at once.
    const status = (await db.purchaseOrder.findFirst({ where: { companyId, number: po.number }, select: { status: true } }))?.status;
    if (status === "PENDING_APPROVAL") await step("purchasing_approveOrder", { order: po.number });
    else results.purchasing_approveOrder = `skipped: order is ${status} (no approval rule applies)`;
    await step("purchasing_receiveOrder", { order: po.number, warehouseCode });
  }
  const po2 = await step("purchasing_createOrder", { supplierId: supplier.id, warehouseCode, lines: [{ itemCode, quantity: "1", unitPrice: "40.00" }] });
  if (po2) await step("purchasing_cancelOrder", { order: po2.number });
  const si = await db.supplierInvoice.findFirst({ where: { companyId, documentType: "INVOICE", lines: { some: { accountId: { not: null } } } }, orderBy: { createdAt: "desc" }, select: { number: true, lines: { where: { accountId: { not: null } }, take: 1, select: { description: true } } } });
  if (si) await step("purchasing_supplierDebitNote", { invoice: si.number, notes: "Overcharge", lines: [{ ...(si.lines[0]?.description ? { description: si.lines[0].description } : {}), quantity: "1", unitPrice: "1.00" }] });
  else results.purchasing_supplierDebitNote = "skipped: no supplier invoice with an account line";

  // 4. Inventory, accounting, parties
  const item = await db.item.findFirstOrThrow({ where: { companyId, code: itemCode } });
  await step("inventory_updateItem", { itemCode, reorderPoint: item.reorderPoint ? item.reorderPoint.toString() : "0" });
  const wh = await db.warehouse.findFirstOrThrow({ where: { companyId, code: warehouseCode } });
  await step("inventory_updateWarehouse", { warehouseCode, name: wh.name });
  await step("parties_update", { partyId: customer.id, city: customer.city ?? "Riyadh" });
  const cc = await db.costCenter.findFirst({ where: { companyId }, select: { code: true } });
  await step("inventory_stockIssue", { warehouseCode, costCenter: cc ? cc.code : "GENERAL", lines: [{ itemCode, quantity: "1" }] });
  const je = await step("accounting_journalEntry", { description: "AI live test adjustment", lines: [{ accountCode: expense.code, debit: "10.00" }, { accountCode: cash.code, credit: "10.00" }] });
  if (je) await step("accounting_reverseJournalEntry", { entry: je.number, reason: "AI live test" });

  // 5. HR and assets
  const emp = await db.employee.findFirst({ where: { companyId, isActive: true }, select: { id: true } });
  if (emp) await step("hr_salaryAdvance", { employeeId: emp.id, amount: "300.00", installmentAmount: "100.00", cashAccountCode: cash.code });
  const cat = await db.fixedAssetCategory.findFirst({ where: { companyId }, select: { code: true } });
  if (cat) {
    const fa = await step("assets_create", { name: "AI live test laptop", categoryCode: cat.code, acquisitionDate: new Date().toISOString().slice(0, 10), acquisitionCost: "3000.00" });
    if (fa) await step("assets_capitalize", { asset: fa.number, sourceAccountCode: cash.code });
  }
  // Payroll and depreciation post a whole month: preview only on shared demo data.
  for (const [n, a] of [["hr_payrollRun", { periodYear: 2026, periodMonth: 11 }], ["assets_depreciationRun", { periodYear: 2026, periodMonth: 11 }]]) {
    const t = tools.get(n);
    const p = await t.preview(ctx, t.input.parse(a));
    results[n] = `preview ${JSON.stringify(p.fields.map((f) => f.value))}`;
  }

  console.log(JSON.stringify(results, null, 2));
  const failed = Object.values(results).filter((v) => String(v).startsWith("FAILED")).length;
  console.log(`failed=${failed} of ${Object.keys(results).length}`);
  await db.$disconnect();
  await app.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
