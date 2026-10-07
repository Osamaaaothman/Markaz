import { createHash } from "node:crypto";
import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger, IPermissionService } from "../contracts.js";
import {
  CONTENT_TYPE_EXTENSIONS,
  DEFAULT_MAX_BYTES,
  HARD_MAX_BYTES,
  OWNER_RULES,
  OWNER_TYPES,
  detectContentType,
  isOwnerType,
  newStorageKey,
  sanitizeFileName,
  type AttachmentOwnerType,
  type AttachmentVisibility,
} from "./attachment-rules.js";
import type { IFileStorage } from "./file-storage.js";

export class AttachmentError extends Error {
  constructor(
    readonly code:
      | "INVALID_OWNER_TYPE"
      | "OWNER_NOT_FOUND"
      | "NOT_FOUND"
      | "EMPTY_FILE"
      | "FILE_TOO_LARGE"
      | "UNSUPPORTED_FILE_TYPE"
      | "FORBIDDEN_OWNER"
      | "INTEGRITY_FAILED",
    message: string,
  ) {
    super(message);
  }
}

export interface AttachmentActor {
  readonly id: string;
  readonly companyId: string;
}

export interface AttachmentSummary {
  readonly id: string;
  readonly ownerType: AttachmentOwnerType;
  readonly ownerId: string;
  // The readable name of the record it belongs to (invoice number, party name...), null if it cannot be resolved.
  readonly ownerLabel: string | null;
  readonly visibility: AttachmentVisibility;
  readonly originalName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly createdByEmail: string | null;
  readonly publicUrl: string | null;
}

export interface AttachmentListQuery {
  readonly ownerType?: string | undefined;
  readonly q?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
}

export interface AttachmentListPage {
  readonly data: readonly AttachmentSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface AttachmentContent {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly originalName: string;
}

export interface UploadInput {
  readonly ownerType: string;
  readonly ownerId: string;
  // As sent by the browser: shown to people, never used as a path.
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

interface AttachmentRow {
  readonly id: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly visibility: string;
  readonly originalName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly publicUrl: string | null;
}

const ROW_SELECT = {
  id: true,
  ownerType: true,
  ownerId: true,
  visibility: true,
  originalName: true,
  contentType: true,
  sizeBytes: true,
  createdBy: true,
  createdAt: true,
  publicUrl: true,
} as const;

// Scans and photos of bills, receipts and supporting papers, linked to a business record. Framework-free like the
// other core services. The rules that matter, all enforced here and not left to the screen:
//  - the bytes are identified by their first bytes, never by the name or the browser's claim;
//  - you can only attach to, list or open files of a record you may read yourself;
//  - visibility is decided by the owner type (attachment-rules.ts), never by the caller;
//  - a file is never edited; "delete" only marks it removed (and the file stays in storage for retention);
//  - every upload and removal is audited, and a stored file is re-checked against its SHA-256 when opened.
export class AttachmentService {
  private readonly maxBytes: number;
  private readonly storages: ReadonlyMap<string, IFileStorage>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
    private readonly permissions: IPermissionService,
    private readonly activeStorage: IFileStorage,
    options: { readonly maxBytes?: number; readonly otherStorages?: readonly IFileStorage[] } = {},
  ) {
    this.maxBytes = Math.min(options.maxBytes ?? DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
    // Files stay on the provider that stored them: switching provider later does not strand old files.
    this.storages = new Map([activeStorage, ...(options.otherStorages ?? [])].map((storage) => [storage.provider, storage] as const));
  }

  // ---- ownership -------------------------------------------------------------------------------------------

  private canRead(actor: AttachmentActor, ownerType: AttachmentOwnerType): Promise<boolean> {
    return this.permissions.can(actor.id, "read", OWNER_RULES[ownerType].readResource, actor.companyId);
  }

  // The readable label of a record in the caller's company, or null when there is no such record.
  private async ownerLabels(companyId: string, ownerType: AttachmentOwnerType, ids: readonly string[]): Promise<Map<string, string>> {
    const where = { companyId, id: { in: [...ids] } };
    const labels = new Map<string, string>();
    const put = (rows: readonly { id: string; label: string }[]): Map<string, string> => {
      for (const row of rows) labels.set(row.id, row.label);
      return labels;
    };
    switch (ownerType) {
      case "SALES_INVOICE":
        return put((await this.prisma.salesInvoice.findMany({ where, select: { id: true, number: true } })).map((r) => ({ id: r.id, label: r.number })));
      case "SUPPLIER_INVOICE":
        return put((await this.prisma.supplierInvoice.findMany({ where, select: { id: true, number: true } })).map((r) => ({ id: r.id, label: r.number })));
      case "PAYMENT":
        return put((await this.prisma.payment.findMany({ where, select: { id: true, number: true } })).map((r) => ({ id: r.id, label: r.number })));
      case "JOURNAL_ENTRY":
        return put((await this.prisma.journalEntry.findMany({ where, select: { id: true, number: true } })).map((r) => ({ id: r.id, label: r.number })));
      case "PURCHASE_ORDER":
        return put((await this.prisma.purchaseOrder.findMany({ where, select: { id: true, number: true } })).map((r) => ({ id: r.id, label: r.number })));
      case "PARTY":
        return put((await this.prisma.party.findMany({ where, select: { id: true, ref: true, name: true } })).map((r) => ({ id: r.id, label: `${r.ref} ${r.name}` })));
      case "ITEM":
        return put((await this.prisma.item.findMany({ where, select: { id: true, code: true, name: true } })).map((r) => ({ id: r.id, label: `${r.code} ${r.name}` })));
    }
  }

  private async toSummaries(companyId: string, rows: readonly AttachmentRow[]): Promise<AttachmentSummary[]> {
    const labelsByType = new Map<AttachmentOwnerType, Map<string, string>>();
    for (const type of OWNER_TYPES) {
      const ids = rows.filter((r) => r.ownerType === type).map((r) => r.ownerId);
      if (ids.length > 0) labelsByType.set(type, await this.ownerLabels(companyId, type, [...new Set(ids)]));
    }
    const users = await this.prisma.user.findMany({
      where: { companyId, id: { in: [...new Set(rows.map((r) => r.createdBy))] } },
      select: { id: true, email: true },
    });
    const emails = new Map(users.map((u) => [u.id, u.email]));
    return rows.map((row) => ({
      id: row.id,
      ownerType: row.ownerType as AttachmentOwnerType,
      ownerId: row.ownerId,
      ownerLabel: labelsByType.get(row.ownerType as AttachmentOwnerType)?.get(row.ownerId) ?? null,
      visibility: row.visibility as AttachmentVisibility,
      originalName: row.originalName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
      createdByEmail: emails.get(row.createdBy) ?? null,
      publicUrl: row.publicUrl,
    }));
  }

  // ---- operations ------------------------------------------------------------------------------------------

  async upload(input: UploadInput, actor: AttachmentActor, correlationId: string): Promise<AttachmentSummary> {
    if (!isOwnerType(input.ownerType)) throw new AttachmentError("INVALID_OWNER_TYPE", "Unknown record type");
    const ownerType = input.ownerType;
    if (input.bytes.length === 0) throw new AttachmentError("EMPTY_FILE", "The file is empty");
    if (input.bytes.length > this.maxBytes) throw new AttachmentError("FILE_TOO_LARGE", `The file is larger than ${this.maxBytes} bytes`);
    const contentType = detectContentType(input.bytes);
    if (!contentType) throw new AttachmentError("UNSUPPORTED_FILE_TYPE", "Only PDF, PNG, JPEG and WebP files are accepted");

    if (!(await this.canRead(actor, ownerType))) throw new AttachmentError("FORBIDDEN_OWNER", "No access to this kind of record");
    const labels = await this.ownerLabels(actor.companyId, ownerType, [input.ownerId]);
    if (!labels.has(input.ownerId)) throw new AttachmentError("OWNER_NOT_FOUND", "The record does not exist in this company");

    const id = newId();
    const visibility = OWNER_RULES[ownerType].visibility;
    const key = newStorageKey(newId());
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");

    // The file first, then its row: a failed upload leaves no row pointing at nothing. The opposite failure
    // (row insert fails after the file is stored) leaves an unreferenced file, which is harmless and invisible.
    const stored = await this.activeStorage.put({ key, bytes: input.bytes, contentType, visibility });
    const row = await this.prisma.attachment.create({
      data: {
        id,
        companyId: actor.companyId,
        ownerType,
        ownerId: input.ownerId,
        visibility,
        originalName: sanitizeFileName(input.fileName, CONTENT_TYPE_EXTENSIONS[contentType]),
        contentType,
        sizeBytes: input.bytes.length,
        sha256,
        storageProvider: this.activeStorage.provider,
        storageKey: key,
        publicUrl: stored.publicUrl,
        createdBy: actor.id,
      },
      select: ROW_SELECT,
    });

    await this.audit.log({
      actorId: actor.id,
      action: "attachment.uploaded",
      entityType: "Attachment",
      entityId: id,
      after: { ownerType, ownerId: input.ownerId, originalName: row.originalName, contentType, sizeBytes: row.sizeBytes, sha256, visibility },
      correlationId,
    });
    return (await this.toSummaries(actor.companyId, [row]))[0] as AttachmentSummary;
  }

  async listForOwner(actor: AttachmentActor, ownerType: string, ownerId: string): Promise<AttachmentSummary[]> {
    if (!isOwnerType(ownerType)) throw new AttachmentError("INVALID_OWNER_TYPE", "Unknown record type");
    if (!(await this.canRead(actor, ownerType))) throw new AttachmentError("FORBIDDEN_OWNER", "No access to this kind of record");
    const rows = await this.prisma.attachment.findMany({
      where: { companyId: actor.companyId, ownerType, ownerId, deletedAt: null },
      select: ROW_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return this.toSummaries(actor.companyId, rows);
  }

  // Every file of the company the caller may see, newest first. Owner types the caller cannot read are left out.
  async listAll(actor: AttachmentActor, query: AttachmentListQuery): Promise<AttachmentListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const allowed: AttachmentOwnerType[] = [];
    for (const type of OWNER_TYPES) if (await this.canRead(actor, type)) allowed.push(type);
    const wanted = query.ownerType && isOwnerType(query.ownerType) ? allowed.filter((t) => t === query.ownerType) : allowed;
    const q = query.q?.trim();

    const rows = await this.prisma.attachment.findMany({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        ownerType: { in: wanted },
        ...(q ? { originalName: { contains: q, mode: "insensitive" as const } } : {}),
      },
      select: ROW_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { data: await this.toSummaries(actor.companyId, page), pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null } };
  }

  // The file itself, after the permission check and an integrity check against the SHA-256 taken at upload.
  async getContent(actor: AttachmentActor, id: string): Promise<AttachmentContent> {
    const row = await this.prisma.attachment.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      select: { ownerType: true, visibility: true, originalName: true, contentType: true, sha256: true, storageProvider: true, storageKey: true },
    });
    if (!row || !isOwnerType(row.ownerType)) throw new AttachmentError("NOT_FOUND", "Attachment not found");
    // Same answer as "not found" for someone who may not read the record, so existence is not revealed.
    if (!(await this.canRead(actor, row.ownerType))) throw new AttachmentError("NOT_FOUND", "Attachment not found");

    const storage = this.storages.get(row.storageProvider);
    if (!storage) throw new AttachmentError("NOT_FOUND", "The storage that holds this file is not configured");
    const bytes = await storage.get(row.storageKey, row.visibility as AttachmentVisibility);
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
      throw new AttachmentError("INTEGRITY_FAILED", "The stored file does not match its recorded checksum");
    }
    return { bytes, contentType: row.contentType, originalName: row.originalName };
  }

  // Marks the attachment removed. The row and the stored file are kept (retention); it just stops being listed.
  async remove(actor: AttachmentActor, id: string, correlationId: string): Promise<boolean> {
    const row = await this.prisma.attachment.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null }, select: { id: true, ownerType: true, ownerId: true, originalName: true } });
    if (!row || !isOwnerType(row.ownerType) || !(await this.canRead(actor, row.ownerType))) return false;
    const result = await this.prisma.attachment.updateMany({ where: { id, companyId: actor.companyId, deletedAt: null }, data: { deletedAt: new Date(), deletedBy: actor.id } });
    if (result.count === 0) return false;
    await this.audit.log({
      actorId: actor.id,
      action: "attachment.removed",
      entityType: "Attachment",
      entityId: id,
      before: { ownerType: row.ownerType, ownerId: row.ownerId, originalName: row.originalName },
      correlationId,
    });
    return true;
  }
}
