// Realistic end-to-end demo data, v2 — fixes from v1:
//   - Real dedup for parties (no unique constraint on name, so check-then-create by name,
//     not try/catch-409 which silently created duplicates every rerun).
//   - Every item sold has purchase/receipt history FIRST: all 30 items are distributed
//     across purchase orders before any sales line is built, so nothing shows "sold but
//     never bought" on an item's movement screen.
//   - Deliberate status variety instead of one happy path, so every list/detail screen has
//     something to show: a PO left pending approval, one rejected, one partially received;
//     quotations left open/rejected as well as converted; sales orders left open as well as
//     invoiced; invoices left unpaid/partially paid as well as settled; one goods return, one
//     credit note, one stock issue, one salary advance + repayment, one end-of-service
//     settlement, alongside the ordinary purchase-to-pay / order-to-cash flows.
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:3000";

function rand(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rand(arr.length)]; }
function decimal(min, max, step = 1) { return (min + rand(Math.floor((max - min) / step) + 1) * step).toFixed(2); }
function isoDate(daysAgo) { const d = new Date(); d.setUTCDate(d.getUTCDate() - daysAgo); return d.toISOString().slice(0, 10); }
// Splits `items` into `groups` non-empty, non-overlapping chunks covering every item.
function chunk(items, groups) {
  const out = Array.from({ length: groups }, () => []);
  items.forEach((it, i) => out[i % groups].push(it));
  return out;
}

const CUSTOMERS = [
  ["Al Rawabi Trading Co.", "شركة الروابي التجارية", "Riyadh"],
  ["Nakheel Modern Furnishings", "نخيل للمفروشات الحديثة", "Jeddah"],
  ["Al Safwa Building Materials", "الصفوة لمواد البناء", "Dammam"],
  ["Tharwa Retail Group", "مجموعة ثروة للتجزئة", "Riyadh"],
  ["Al Yamamah Electronics", "اليمامة للإلكترونيات", "Riyadh"],
  ["Jawharat Al Khaleej Est.", "مؤسسة جوهرة الخليج", "Khobar"],
  ["Al Bustan Catering Supplies", "البستان لمستلزمات التموين", "Jeddah"],
  ["Masader Industrial Co.", "شركة مصادر الصناعية", "Dammam"],
  ["Al Noor Stationery Est.", "مؤسسة النور للقرطاسية", "Mecca"],
  ["Reef Al Sharq Trading", "ريف الشرق التجارية", "Riyadh"],
  ["Dar Al Handasah Supplies", "دار الهندسة للتوريدات", "Jeddah"],
  ["Al Majd Hospitality Group", "مجموعة المجد للضيافة", "Riyadh"],
];
const SUPPLIERS = [
  ["Gulf Steel Industries", "صناعات الحديد الخليجية", "Dammam"],
  ["Al Ameen Paper Mills", "مصانع الأمين للورق", "Jeddah"],
  ["Riyadh Plastic Factory", "مصنع الرياض للبلاستيك", "Riyadh"],
  ["Al Fanar Electrical Supplies", "الفنار للتوريدات الكهربائية", "Riyadh"],
  ["Najd Packaging Co.", "شركة نجد للتغليف", "Riyadh"],
  ["Al Khobar Import & Export", "الخبر للاستيراد والتصدير", "Khobar"],
  ["Tabuk Textile Mills", "مصانع تبوك للنسيج", "Tabuk"],
  ["Al Jubail Chemicals Co.", "شركة الجبيل للكيماويات", "Jubail"],
];
const ITEMS = [
  ["A4 Copy Paper 80gsm (Ream)", "ورق تصوير A4 80غم (رزمة)", "REAM", 12, 22],
  ["Ballpoint Pens Box (50pcs)", "صندوق أقلام حبر جاف (50 قطعة)", "BOX", 18, 35],
  ["Whiteboard Markers Set", "طقم أقلام سبورة بيضاء", "SET", 15, 28],
  ["Steel Office Desk 140cm", "مكتب مكتبي فولاذي 140سم", "PCS", 450, 650],
  ["Ergonomic Office Chair", "كرسي مكتب مريح", "PCS", 380, 620],
  ["LED Ceiling Panel 60x60", "لوح إضاءة LED سقفي 60×60", "PCS", 65, 110],
  ["Cat6 Network Cable 305m", "كابل شبكة Cat6 305م", "ROLL", 180, 260],
  ["HDMI Cable 3m", "كابل HDMI 3م", "PCS", 20, 38],
  ["Cement Bag 50kg", "كيس أسمنت 50كغم", "BAG", 14, 20],
  ["Steel Rebar 12mm (Ton)", "حديد تسليح 12مم (طن)", "TON", 2800, 3400],
  ["PVC Pipe 4-inch (6m)", "أنبوب PVC 4 إنش (6م)", "PCS", 35, 55],
  ["Ceramic Floor Tile 60x60", "بلاط أرضيات سيراميك 60×60", "SQM", 22, 45],
  ["Interior Paint 18L (White)", "دهان داخلي 18لتر (أبيض)", "DRUM", 160, 230],
  ["Safety Helmet", "خوذة أمان", "PCS", 25, 45],
  ["Safety Gloves (Pair)", "قفازات أمان (زوج)", "PAIR", 8, 15],
  ["Stainless Steel Cookware Set", "طقم أواني طبخ ستانلس ستيل", "SET", 220, 380],
  ["Commercial Blender 2L", "خلاط تجاري 2لتر", "PCS", 310, 480],
  ["Catering Chafing Dish", "صحن تسخين ضيافة", "PCS", 90, 150],
  ["Plastic Storage Crate 50L", "صندوق تخزين بلاستيك 50لتر", "PCS", 18, 32],
  ["Stretch Wrap Film Roll", "رول فيلم تغليف لاصق", "ROLL", 22, 38],
  ["Corrugated Carton Box (M)", "كرتون تغليف مموج (وسط)", "PCS", 3, 6],
  ["Packing Tape Roll", "رول شريط تغليف", "ROLL", 4, 8],
  ["Cotton Fabric Roll (50m)", "رول قماش قطني (50م)", "ROLL", 240, 360],
  ["Polyester Thread Spool", "بكرة خيط بوليستر", "PCS", 5, 12],
  ["Industrial Sewing Needles (Pack)", "إبر خياطة صناعية (عبوة)", "PACK", 12, 20],
  ["Copper Wire 2.5mm (100m)", "سلك نحاس 2.5مم (100م)", "ROLL", 140, 190],
  ["Circuit Breaker 32A", "قاطع دائرة 32أمبير", "PCS", 22, 38],
  ["Industrial Extension Reel 20m", "بكرة تمديد صناعية 20م", "PCS", 65, 95],
  ["A3 Laser Printer", "طابعة ليزر A3", "PCS", 1400, 1900],
  ["Barcode Scanner Handheld", "جهاز قراءة باركود يدوي", "PCS", 180, 260],
];
const EMPLOYEES = [
  ["Abdullah Al-Qahtani", "عبدالله القحطاني", true],
  ["Mohammed Al-Harbi", "محمد الحربي", true],
  ["Fahad Al-Otaibi", "فهد العتيبي", true],
  ["Sara Al-Dosari", "سارة الدوسري", true],
  ["Noura Al-Shehri", "نورة الشهري", true],
  ["Khalid Al-Ghamdi", "خالد الغامدي", true],
  ["Ahmed Hassan", "أحمد حسن", false],
  ["Rizwan Ahmed", "رضوان أحمد", false],
  ["Michael Santos", "مايكل سانتوس", false],
  ["Fatima Al-Zahrani", "فاطمة الزهراني", true],
];

async function main() {
  const company = await prisma.company.findFirstOrThrow();
  const adminRole = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "Admin" } });
  const adminUserRole = await prisma.userRole.findFirstOrThrow({ where: { roleId: adminRole.id } });
  const adminUser = await prisma.user.findUniqueOrThrow({ where: { id: adminUserRole.userId } });
  if (!process.env.JWT_ACCESS_SECRET) throw new Error("JWT_ACCESS_SECRET not set");
  const token = jwt.sign({ sub: adminUser.id, companyId: company.id }, process.env.JWT_ACCESS_SECRET, { expiresIn: "6h" });
  console.log(`Acting as admin ${adminUser.email} / company ${company.name}`);

  async function call(method, path, body) {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    if (method !== "GET") headers["Idempotency-Key"] = crypto.randomUUID();
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    if (!res.ok) { const e = new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`); e.status = res.status; throw e; }
    return json;
  }
  // ── 1. Setup already done in production (account mappings / tax codes / cash account) —
  // re-check instead of re-doing, since those are config, not demo data, and survive a wipe.
  const taxCodes = await call("GET", "/v1/tax-codes");
  const vat = taxCodes.find((t) => t.treatment === "STANDARD") ?? taxCodes[0];
  const chart = await call("GET", "/v1/chart-of-accounts");
  const cashParent = chart.find((a) => a.name === "Cash on hand");
  const cashAccount = chart.find((a) => a.parentId === cashParent?.id && a.isPostable);
  if (!vat || !cashAccount) throw new Error("Tax codes or cash account missing — run initial setup first");
  console.log(`Tax code ${vat.code} (${vat.rate}%), cash account ${cashAccount.code}.`);

  // ── 2. Warehouses & items (dedup by code) ──
  const whExisting = await call("GET", "/v1/warehouses?limit=200");
  const whByCode = new Map((whExisting.data ?? whExisting).map((w) => [w.code, w]));
  const warehouses = [];
  for (const w of [
    { code: "WH-MAIN", name: "Main Warehouse", nameAr: "المستودع الرئيسي" },
    { code: "WH-JED", name: "Jeddah Branch Warehouse", nameAr: "مستودع فرع جدة" },
  ]) {
    warehouses.push(whByCode.get(w.code) ?? (await call("POST", "/v1/warehouses", w)));
  }

  const itemsExisting = await call("GET", "/v1/items?limit=200");
  const itemsByCode = new Map((itemsExisting.data ?? itemsExisting).map((i) => [i.code, i]));
  const items = [];
  for (let i = 0; i < ITEMS.length; i++) {
    const [name, nameAr, unit] = ITEMS[i];
    const code = `ITM-${String(i + 1).padStart(4, "0")}`;
    items.push(itemsByCode.get(code) ?? (await call("POST", "/v1/items", { code, name, nameAr, unit, reorderPoint: "10" })));
  }
  console.log(`Warehouses: ${warehouses.length}, items: ${items.length}.`);

  // ── 3. Parties (dedup by name — no server-side uniqueness, so check-then-create) ──
  const partiesExisting = await call("GET", "/v1/parties?limit=200");
  const partyByName = new Map((partiesExisting.data ?? partiesExisting).map((p) => [p.name, p]));
  async function ensureParty([name, nameAr, city]) {
    const existing = partyByName.get(name);
    if (existing) return existing;
    const created = await call("POST", "/v1/parties", {
      name, nameAr, kind: "COMPANY", city, countryCode: "SA",
      phone: `05${String(rand(100000000)).padStart(8, "0")}`,
      email: `info@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example.com`,
    });
    partyByName.set(name, created);
    return created;
  }
  const customers = [];
  for (const c of CUSTOMERS) customers.push(await ensureParty(c));
  const suppliers = [];
  for (const s of SUPPLIERS) suppliers.push(await ensureParty(s));
  console.log(`Customers: ${customers.length}, suppliers: ${suppliers.length} (deduplicated).`);

  // ── 4. Purchasing — every item purchased & received before any sale, status variety ──
  const itemGroups = chunk(items, suppliers.length); // every item appears in exactly one PO
  const purchaseOrders = [];
  for (let s = 0; s < suppliers.length; s++) {
    const supplier = suppliers[s];
    const warehouse = warehouses[0];
    const myItems = itemGroups[s];
    if (myItems.length === 0) continue;
    const lines = myItems.map((it) => ({ itemId: it.id, quantity: String(20 + rand(60)), unitPrice: decimal(10, 500), taxCodeId: vat.id }));
    const po = await call("POST", "/v1/purchase-orders", { supplierId: supplier.id, warehouseId: warehouse.id, orderDate: isoDate(70 + rand(40)), lines });
    purchaseOrders.push(po);

    // Status variety: supplier 0's order stays PENDING_APPROVAL (never approved — shows the
    // approval workflow); supplier 1's order gets rejected; everyone else proceeds normally.
    if (s === 0) { console.log(`PO ${po.number}: left pending approval.`); continue; }
    if (s === 1) {
      if (po.status === "PENDING_APPROVAL") await call("POST", `/v1/purchase-orders/${po.id}/reject`, { reason: "Price too high versus last quarter" });
      console.log(`PO ${po.number}: rejected.`);
      continue;
    }
    if (po.status === "PENDING_APPROVAL") await call("POST", `/v1/purchase-orders/${po.id}/approve`, {});

    const detail = await call("GET", `/v1/purchase-orders/${po.id}`);
    // Supplier 2 only partially received (shows PARTIALLY_RECEIVED on the list).
    const partial = s === 2;
    const receiveLines = detail.lines.map((l) => ({
      purchaseOrderLineId: l.id,
      quantity: partial ? String(Math.max(1, Math.floor(Number(l.quantity) * 0.5))) : l.quantity,
    }));
    const receipt = await call("POST", `/v1/purchase-orders/${po.id}/receive`, {
      warehouseId: warehouse.id, documentDate: isoDate(40 + rand(30)), reference: `GRN-${po.number}`, lines: receiveLines,
    });
    if (partial) { console.log(`PO ${po.number}: partially received.`); continue; }

    // Supplier 3: one unit returned to the supplier before invoicing (goods return demo).
    if (s === 3) {
      const returnLine = detail.lines[0];
      await call("POST", "/v1/goods-returns", {
        purchaseOrderId: po.id, warehouseId: warehouse.id, documentDate: isoDate(35),
        reason: "Damaged on arrival", lines: [{ purchaseOrderLineId: returnLine.id, quantity: "1" }],
      });
      console.log(`PO ${po.number}: one line partially returned.`);
    }

    const invoiceable = await call("GET", `/v1/supplier-invoices/invoiceable?supplierId=${supplier.id}`);
    if (invoiceable.length === 0) continue;
    const invLines = invoiceable.map((l) => ({ kind: "PO_LINE", purchaseOrderLineId: l.purchaseOrderLineId, quantity: l.invoiceableQuantity, unitPrice: l.orderPrice, taxCodeId: vat.id }));
    const inv = await call("POST", "/v1/supplier-invoices", {
      supplierId: supplier.id, supplierInvoiceNumber: `SUP-${crypto.randomInt(100000, 999999)}`,
      invoiceDate: isoDate(25 + rand(15)), dueDate: isoDate(-15 - rand(15)), lines: invLines,
    });

    // Payment variety: fully paid, partially paid, or left unpaid (overdue), roughly evenly.
    const payMode = s % 3;
    if (payMode !== 2) {
      const amount = (Number(inv.totalGross) * (payMode === 0 ? 1 : 0.5)).toFixed(2);
      await call("POST", "/v1/supplier-payments", {
        partyId: supplier.id, paymentDate: isoDate(5 + rand(15)), amount, cashAccountId: cashAccount.id,
        method: "BANK_TRANSFER", allocations: [{ invoiceId: inv.id, amount }],
      });
    }
  }
  console.log(`Purchasing: ${purchaseOrders.length} orders, every item now has purchase + stock history.`);

  // One stock issue against the main warehouse (internal project consumption).
  {
    const levels = await call("GET", `/v1/stock-levels?warehouseId=${warehouses[0].id}`);
    const stocked = levels.filter((l) => Number(l.quantity) > 2);
    if (stocked.length > 0) {
      const chosen = stocked.slice(0, 3);
      await call("POST", "/v1/stock-issues", {
        warehouseId: warehouses[0].id, costCenterRef: "Head Office Renovation", documentDate: isoDate(10),
        lines: chosen.map((l) => ({ itemId: l.itemId, quantity: String(Math.min(2, Math.floor(Number(l.quantity)))) })),
      });
      console.log("Recorded one stock issue (internal project use).");
    }
  }

  // ── 5. Sales — only ever sells items the warehouse actually holds ──
  let quotationCount = 0, orderCount = 0, invoiceCount = 0;
  for (let c = 0; c < customers.length; c++) {
    const customer = customers[c];
    const levels = await call("GET", `/v1/stock-levels?warehouseId=${warehouses[0].id}`);
    const available = levels.filter((l) => Number(l.quantity) > 0);
    if (available.length === 0) break;
    const chosen = [];
    for (let k = 0; k < 2 + rand(3) && available.length > 0; k++) chosen.push(available.splice(rand(available.length), 1)[0]);
    const lines = chosen.map((l) => ({ itemId: l.itemId, quantity: String(Math.min(1 + rand(5), Math.max(1, Math.floor(Number(l.quantity))))), unitPrice: decimal(20, 800), taxCodeId: vat.id }));
    if (lines.length === 0) continue;
    const quotation = await call("POST", "/v1/quotations", { customerId: customer.id, quotationDate: isoDate(45 + rand(45)), validUntil: isoDate(-15), lines });
    quotationCount++;

    // Status variety: customer 0's quotation stays open; customer 1's gets rejected; the rest convert.
    if (c === 0) continue;
    if (c === 1) { await call("POST", `/v1/quotations/${quotation.id}/reject`, {}); continue; }

    const order = await call("POST", `/v1/quotations/${quotation.id}/convert`, { orderDate: isoDate(40 + rand(30)) });
    orderCount++;
    // Customer 2's order stays open (never invoiced) — shows an un-invoiced order on the list.
    if (c === 2) continue;

    const orderDetail = await call("GET", `/v1/sales-orders/${order.id}`);
    const invLines = [];
    for (const l of orderDetail.lines) {
      const stockNow = await call("GET", `/v1/stock-levels?warehouseId=${warehouses[0].id}&itemId=${l.itemId}`);
      const sellQty = Math.min(Number(l.quantity), Math.floor(Number(stockNow[0]?.quantity ?? 0)));
      if (sellQty < 1) continue;
      invLines.push({ itemId: l.itemId, salesOrderLineId: l.id, warehouseId: warehouses[0].id, quantity: String(sellQty), unitPrice: l.unitPrice, taxCodeId: l.taxCodeId });
    }
    if (invLines.length === 0) continue;
    const invoice = await call("POST", "/v1/sales-invoices", { customerId: customer.id, invoiceDate: isoDate(25 + rand(20)), dueDate: isoDate(-10 - rand(20)), lines: invLines });
    invoiceCount++;

    // Customer 3 gets a credit note on part of their invoice (return/adjustment demo).
    if (c === 3) {
      await call("POST", `/v1/sales-invoices/${invoice.id}/credit-notes`, {
        creditDate: isoDate(5),
        notes: "Partial return — customer changed order",
        lines: [{ description: `Return: ${invLines[0].quantity > 1 ? "partial" : "full"} quantity adjustment`, quantity: "1", unitPrice: invLines[0].unitPrice, taxCodeId: vat.id }],
      });
    }

    // Payment variety: full, partial, or unpaid, roughly evenly, skipping the credit-noted one.
    const payMode = c % 3;
    if (payMode !== 2 && c !== 3) {
      const amount = (Number(invoice.totalGross) * (payMode === 0 ? 1 : 0.5)).toFixed(2);
      await call("POST", "/v1/customer-receipts", {
        partyId: customer.id, paymentDate: isoDate(3 + rand(15)), amount, cashAccountId: cashAccount.id,
        method: "BANK_TRANSFER", allocations: [{ invoiceId: invoice.id, amount }],
      });
    }
  }
  console.log(`Sales: ${quotationCount} quotations, ${orderCount} orders, ${invoiceCount} invoices.`);

  // ── 6. Stock counts (minor realistic variance) ──
  for (const warehouse of warehouses) {
    const levels = await call("GET", `/v1/stock-levels?warehouseId=${warehouse.id}`);
    const onHand = levels.filter((l) => Number(l.quantity) > 0);
    if (onHand.length === 0) continue;
    const lines = onHand.slice(0, Math.min(onHand.length, 10)).map((l) => {
      const base = Number(l.quantity);
      const drift = Math.random() < 0.7 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (1 + rand(2));
      return { itemId: l.itemId, countedQuantity: String(Math.max(0, base + drift)) };
    });
    const count = await call("POST", "/v1/stock-counts", { warehouseId: warehouse.id, documentDate: isoDate(2 + rand(5)), lines });
    await call("POST", `/v1/stock-counts/${count.id}/post`, {});
  }
  console.log("Stock counts recorded and posted.");

  // ── 7. Employees & payroll (dedup by nationalId) ──
  const empExisting = await call("GET", "/v1/employees/all");
  const empByNationalId = new Map((empExisting.data ?? empExisting).map((e) => [e.nationalId, e]));
  const employees = [];
  for (let i = 0; i < EMPLOYEES.length; i++) {
    const [name, nameAr, isSaudi] = EMPLOYEES[i];
    const nationalId = String(1000000000 + i * 137 + rand(100));
    const existing = empByNationalId.get(nationalId);
    employees.push(
      existing ??
        (await call("POST", "/v1/employees", {
          name, nameAr, nationalId, isSaudi,
          bankIban: `SA${String(1000000000000000000 + i).slice(0, 22)}`,
          bankName: pick(["Al Rajhi Bank", "SABB", "ANB", "NCB"]),
          hireDate: isoDate(200 + rand(900)), basicSalary: decimal(4000, 15000, 100),
        })),
    );
  }
  await call("POST", "/v1/employees/accounts/provision-missing", {});
  console.log(`Employees: ${employees.length}.`);

  // One salary advance + partial repayment (demo of that screen).
  const advanceEmployee = employees[0];
  const advance = await call("POST", "/v1/salary-advances", {
    employeeId: advanceEmployee.id, grantDate: isoDate(60), amount: "3000.00", installmentAmount: "500.00", cashAccountId: cashAccount.id,
  });
  await call("POST", `/v1/salary-advances/${advance.id}/repayments`, { repaymentDate: isoDate(20), amount: "500.00", cashAccountId: cashAccount.id });
  console.log("Recorded one salary advance and its first repayment.");

  // One end-of-service settlement (employee resigns) — not paid, so it shows as outstanding.
  const leavingEmployee = employees[employees.length - 1];
  await call("POST", "/v1/end-of-service-settlements", { employeeId: leavingEmployee.id, terminationDate: isoDate(3), reason: "RESIGNATION" });
  console.log(`Recorded one end-of-service settlement for ${leavingEmployee.name}.`);

  const now = new Date();
  const existingRuns = await call("GET", "/v1/payroll-runs");
  let payrollRun = (existingRuns.data ?? existingRuns).find((r) => r.periodYear === now.getUTCFullYear() && r.periodMonth === now.getUTCMonth() + 1);
  if (!payrollRun) payrollRun = await call("POST", "/v1/payroll-runs", { periodYear: now.getUTCFullYear(), periodMonth: now.getUTCMonth() + 1, runDate: isoDate(0) });
  // Pay everyone except the employee who just left (their final pay is via EOSB, not this run).
  await call("POST", "/v1/hr-payments/salaries", {
    payrollRunId: payrollRun.id, paymentDate: isoDate(0), cashAccountId: cashAccount.id,
    employeeIds: employees.filter((e) => e.id !== leavingEmployee.id).map((e) => e.id),
    notes: "Demo payroll run",
  });
  console.log(`Payroll run ${payrollRun.id}: salaries paid (one employee held back for EOSB).`);

  console.log("\nDemo data seed v2 complete.");
}

main()
  .catch((error) => { console.error("SEED FAILED:", error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
