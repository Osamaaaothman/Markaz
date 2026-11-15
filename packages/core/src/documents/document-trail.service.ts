import type { PrismaClient } from "@erp/db";
import type { IPermissionService } from "../contracts.js";
import type { DraftActor } from "./document-draft.service.js";

export const TRAIL_KINDS = [
  "purchase_request",
  "purchase_order",
  "goods_receipt",
  "supplier_invoice",
  "quotation",
  "sales_order",
  "sales_invoice",
  "payment",
  "journal_entry",
  "stock_issue",
  "stock_count",
  "cash_expense",
] as const;
export type TrailKind = (typeof TRAIL_KINDS)[number];
interface Reference {
  kind: TrailKind;
  id: string;
}
export interface TrailNode extends Reference {
  number: string;
  status: string;
  date: string;
  createdAt: string;
}
type Direction = "upstream" | "downstream" | "attachment";
interface TrailLink extends Reference {
  direction: Direction;
}
interface Loaded {
  node: TrailNode;
  links: TrailLink[];
  truncated: boolean;
}
const refs = (
  kind: TrailKind,
  rows: readonly { id: string }[],
  direction: Direction = "downstream",
): TrailLink[] => rows.map((r) => ({ kind, id: r.id, direction }));
export class DocumentTrailError extends Error {}

/** Read-only traversal. Every node and every outward query remains scoped to the company. */
export class DocumentTrailService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly permissions: IPermissionService,
  ) {}
  async trail(kind: string, id: string, actor: DraftActor) {
    if (!TRAIL_KINDS.includes(kind as TrailKind)) throw new DocumentTrailError("NOT_FOUND");
    const queue: (Reference & { mode: Direction | "root" })[] = [
        { kind: kind as TrailKind, id, mode: "root" },
      ],
      seen = new Set<string>(),
      nodes: TrailNode[] = [],
      edges: { from: string; to: string }[] = [];
    let truncated = false;
    const allowed = new Map<TrailKind, boolean>();
    for (const type of TRAIL_KINDS)
      allowed.set(type, await this.permissions.can(actor.id, "read", type, actor.companyId));
    while (queue.length && seen.size < 80) {
      const ref = queue.shift()!,
        key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!allowed.get(ref.kind)) continue;
      const loaded = await this.load(ref, actor.companyId);
      if (!loaded) continue;
      truncated ||= loaded.truncated;
      nodes.push(loaded.node);
      for (const link of loaded.links) {
        if (!allowed.get(link.kind)) continue;
        // Follow the selected document's ancestry and descendants without turning
        // at shared parents/payments into a different document's workflow.
        if (
          ref.mode === "upstream" &&
          link.direction !== "upstream" &&
          link.kind !== "journal_entry"
        )
          continue;
        if (ref.mode === "downstream" && link.direction === "upstream") continue;
        if (ref.mode === "attachment" && link.direction !== "attachment") continue;
        edges.push({ from: key, to: `${link.kind}:${link.id}` });
        if (!seen.has(`${link.kind}:${link.id}`)) queue.push({ ...link, mode: link.direction });
      }
    }
    if (!nodes.some((n) => n.id === id && n.kind === kind))
      throw new DocumentTrailError("NOT_FOUND");
    const visible = new Set(nodes.map((n) => `${n.kind}:${n.id}`));
    return {
      nodes: nodes.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      edges: edges.filter((e) => visible.has(e.from) && visible.has(e.to)),
      truncated: truncated || queue.length > 0,
    };
  }
  private async load(ref: Reference, companyId: string): Promise<Loaded | null> {
    const { id, kind } = ref,
      where = { id, companyId },
      p = this.prisma;
    const result = (
      row: { id: string; number: string; createdAt: Date },
      date: Date,
      status: string,
      links: TrailLink[],
    ): Loaded => ({
      node: {
        kind: ref.kind,
        id: ref.id,
        number: row.number,
        status,
        date: date.toISOString().slice(0, 10),
        createdAt: row.createdAt.toISOString(),
      },
      links: links.slice(0, 25),
      truncated: links.length > 25,
    });
    const link = (
      kind: TrailKind,
      id: string | null,
      direction: Direction = kind === "journal_entry" ? "attachment" : "upstream",
    ): TrailLink[] => (id ? [{ kind, id, direction }] : []);
    switch (kind) {
      case "purchase_request": {
        const row = await p.purchaseRequest.findFirst({ where });
        return row
          ? result(
              row,
              row.createdAt,
              row.status,
              link("purchase_order", row.purchaseOrderId, "downstream"),
            )
          : null;
      }
      case "purchase_order": {
        const row = await p.purchaseOrder.findFirst({ where });
        if (!row) return null;
        const [requests, receipts, invoices] = await Promise.all([
          p.purchaseRequest.findMany({
            where: { companyId, purchaseOrderId: id },
            select: { id: true },
            take: 26,
          }),
          p.goodsReceipt.findMany({
            where: { companyId, purchaseOrderId: id },
            select: { id: true },
            take: 26,
          }),
          p.supplierInvoice.findMany({
            where: {
              companyId,
              OR: [
                { purchaseOrderId: id },
                { lines: { some: { purchaseOrderLine: { purchaseOrderId: id } } } },
              ],
            },
            select: { id: true },
            take: 26,
          }),
        ]);
        return result(row, row.orderDate, row.status, [
          ...refs("purchase_request", requests, "upstream"),
          ...refs("goods_receipt", receipts),
          ...refs("supplier_invoice", invoices),
        ]);
      }
      case "goods_receipt": {
        const row = await p.goodsReceipt.findFirst({ where });
        return row
          ? result(row, row.documentDate, "POSTED", [
              ...link("purchase_order", row.purchaseOrderId),
              ...link("journal_entry", row.journalEntryId),
            ])
          : null;
      }
      case "quotation": {
        const row = await p.quotation.findFirst({ where });
        return row
          ? result(
              row,
              row.quotationDate,
              row.status,
              link("sales_order", row.salesOrderId, "downstream"),
            )
          : null;
      }
      case "sales_order": {
        const row = await p.salesOrder.findFirst({ where });
        if (!row) return null;
        const [quotations, invoices] = await Promise.all([
          p.quotation.findMany({
            where: { companyId, salesOrderId: id },
            select: { id: true },
            take: 26,
          }),
          p.salesInvoice.findMany({
            where: { companyId, salesOrderId: id },
            select: { id: true },
            take: 26,
          }),
        ]);
        return result(row, row.orderDate, row.status, [
          ...refs("quotation", quotations, "upstream"),
          ...refs("sales_invoice", invoices),
        ]);
      }
      case "sales_invoice": {
        const row = await p.salesInvoice.findFirst({ where });
        if (!row) return null;
        const [notes, allocations] = await Promise.all([
          p.salesInvoice.findMany({
            where: { companyId, originalInvoiceId: id },
            select: { id: true },
            take: 26,
          }),
          p.paymentAllocation.findMany({
            where: { companyId, salesInvoiceId: id },
            select: { paymentId: true },
            take: 26,
          }),
        ]);
        return result(row, row.invoiceDate, row.documentType, [
          ...link("sales_order", row.salesOrderId),
          ...link("sales_invoice", row.originalInvoiceId),
          ...refs("sales_invoice", notes),
          ...allocations.map((a) => ({
            kind: "payment" as const,
            id: a.paymentId,
            direction: "attachment" as const,
          })),
          ...link("journal_entry", row.journalEntryId),
        ]);
      }
      case "supplier_invoice": {
        const row = await p.supplierInvoice.findFirst({
          where,
          include: {
            lines: { select: { purchaseOrderLine: { select: { purchaseOrderId: true } } } },
          },
        });
        if (!row) return null;
        const [notes, allocations] = await Promise.all([
          p.supplierInvoice.findMany({
            where: { companyId, originalInvoiceId: id },
            select: { id: true },
            take: 26,
          }),
          p.paymentAllocation.findMany({
            where: { companyId, supplierInvoiceId: id },
            select: { paymentId: true },
            take: 26,
          }),
        ]);
        return result(row, row.invoiceDate, row.documentType, [
          ...link("purchase_order", row.purchaseOrderId),
          ...row.lines.flatMap((l) =>
            link("purchase_order", l.purchaseOrderLine?.purchaseOrderId ?? null),
          ),
          ...link("supplier_invoice", row.originalInvoiceId),
          ...refs("supplier_invoice", notes),
          ...allocations.map((a) => ({
            kind: "payment" as const,
            id: a.paymentId,
            direction: "attachment" as const,
          })),
          ...link("journal_entry", row.journalEntryId),
        ]);
      }
      case "payment": {
        const row = await p.payment.findFirst({ where });
        if (!row) return null;
        const allocations = await p.paymentAllocation.findMany({
          where: { companyId, paymentId: id },
          take: 26,
        });
        return result(row, row.paymentDate, row.voidedAt ? "VOIDED" : row.direction, [
          ...allocations.flatMap((a) => [
            ...link("sales_invoice", a.salesInvoiceId),
            ...link("supplier_invoice", a.supplierInvoiceId),
          ]),
          ...link("payment", row.reversesPaymentId, "attachment"),
          ...link("payment", row.reversedByPaymentId, "attachment"),
          ...link("journal_entry", row.journalEntryId),
        ]);
      }
      case "journal_entry": {
        const row = await p.journalEntry.findFirst({ where });
        if (!row) return null;
        const sourceType = row.sourceDocumentType.toLowerCase();
        const aliases: Record<string, TrailKind> = {
          customer_receipt: "payment",
          supplier_payment: "payment",
          sales_credit_note: "sales_invoice",
          sales_debit_note: "sales_invoice",
          supplier_credit_note: "supplier_invoice",
          supplier_debit_note: "supplier_invoice",
        };
        const source = aliases[sourceType] ?? (sourceType as TrailKind);
        return result(
          row,
          row.entryDate,
          "POSTED",
          TRAIL_KINDS.includes(source) ? link(source, row.sourceDocumentId) : [],
        );
      }
      case "stock_issue": {
        const row = await p.stockIssue.findFirst({ where });
        return row
          ? result(row, row.documentDate, "POSTED", link("journal_entry", row.journalEntryId))
          : null;
      }
      case "stock_count": {
        const row = await p.stockCount.findFirst({ where });
        if (!row) return null;
        const journals = await p.journalEntry.findMany({
          where: { companyId, sourceDocumentId: id, sourceModule: "inventory" },
          select: { id: true },
          take: 26,
        });
        return result(
          row,
          row.documentDate,
          row.postedAt ? "POSTED" : "DRAFT",
          refs("journal_entry", journals, "attachment"),
        );
      }
      case "cash_expense": {
        const row = await p.cashExpense.findFirst({ where });
        return row
          ? result(row, row.expenseDate, "POSTED", link("journal_entry", row.journalEntryId))
          : null;
      }
    }
  }
}
