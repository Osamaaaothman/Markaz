import { Prisma, type PrismaClient } from "@erp/db";
import type { IAuditLogger, IPermissionService } from "../contracts.js";

export const DRAFT_RESOURCES = {
  customer_receipt: "customer_receipt",
  supplier_payment: "supplier_payment",
  quotation: "quotation",
  sales_order: "sales_order",
  sales_invoice: "sales_invoice",
  purchase_order: "purchase_order",
  supplier_invoice: "supplier_invoice",
  goods_receipt: "goods_receipt",
  stock_issue: "stock_issue",
  stock_count: "stock_count",
  journal_entry: "journal_entry",
  cash_expense: "cash_expense",
  purchase_request: "purchase_request",
} as const;
export type DraftKind = keyof typeof DRAFT_RESOURCES;
export interface DraftActor {
  readonly id: string;
  readonly companyId: string;
}
export class DocumentDraftError extends Error {
  constructor(
    readonly code: "DRAFT_NOT_FOUND" | "DRAFT_CONFLICT" | "DRAFT_FORBIDDEN" | "DRAFT_INVALID",
  ) {
    super(code);
  }
}

export class DocumentDraftService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly permissions: IPermissionService,
    private readonly audit: IAuditLogger,
  ) {}

  private async allowed(kind: string, actor: DraftActor): Promise<void> {
    if (!Object.hasOwn(DRAFT_RESOURCES, kind)) throw new DocumentDraftError("DRAFT_INVALID");
    if (
      !(await this.permissions.can(
        actor.id,
        "create",
        DRAFT_RESOURCES[kind as DraftKind],
        actor.companyId,
      ))
    )
      throw new DocumentDraftError("DRAFT_FORBIDDEN");
  }
  async list(actor: DraftActor) {
    const allowed = await Promise.all(
      Object.entries(DRAFT_RESOURCES).map(async ([kind, resource]) =>
        (await this.permissions.can(actor.id, "create", resource, actor.companyId)) ? kind : null,
      ),
    );
    return this.prisma.documentDraft.findMany({
      where: {
        companyId: actor.companyId,
        userId: actor.id,
        deletedAt: null,
        kind: { in: allowed.filter((k): k is string => k !== null) },
      },
      select: { id: true, kind: true, version: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
  }
  async get(id: string, actor: DraftActor) {
    const row = await this.prisma.documentDraft.findFirst({
      where: { id, companyId: actor.companyId, userId: actor.id, deletedAt: null },
    });
    if (!row) throw new DocumentDraftError("DRAFT_NOT_FOUND");
    await this.allowed(row.kind, actor);
    return row;
  }
  async save(
    id: string,
    kind: string,
    version: number,
    payload: Prisma.InputJsonObject,
    actor: DraftActor,
  ) {
    await this.allowed(kind, actor);
    if (
      !Number.isSafeInteger(version) ||
      version < 0 ||
      Buffer.byteLength(JSON.stringify(payload)) > 128 * 1024
    )
      throw new DocumentDraftError("DRAFT_INVALID");
    if (version === 0) {
      try {
        return await this.prisma.documentDraft.create({
          data: { id, companyId: actor.companyId, userId: actor.id, kind, payload },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
          throw new DocumentDraftError("DRAFT_CONFLICT");
        throw e;
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.documentDraft.updateMany({
        where: { id, companyId: actor.companyId, userId: actor.id, kind, version, deletedAt: null },
        data: { payload, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new DocumentDraftError("DRAFT_CONFLICT");
      return tx.documentDraft.findFirstOrThrow({
        where: { id, companyId: actor.companyId, userId: actor.id },
      });
    });
  }
  async discard(
    id: string,
    version: number,
    actor: DraftActor,
    correlationId: string,
  ): Promise<void> {
    await this.get(id, actor);
    const changed = await this.prisma.documentDraft.updateMany({
      where: { id, companyId: actor.companyId, userId: actor.id, version, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new DocumentDraftError("DRAFT_CONFLICT");
    await this.audit.log({
      actorId: actor.id,
      action: "document_draft.discarded",
      entityType: "DocumentDraft",
      entityId: id,
      correlationId,
    });
  }
}
