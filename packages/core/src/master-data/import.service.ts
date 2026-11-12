import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { TransactionClient } from "../contracts.js";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { allocateRef } from "../reference.js";

export type ImportKind = "items" | "parties";
export interface ImportRow {
  readonly rowNumber: number;
  readonly values: Record<string, unknown>;
}
export interface ImportIssue {
  readonly field: string;
  readonly code: string;
}
export interface ImportPreviewRow {
  readonly rowNumber: number;
  readonly values: Record<string, string>;
  readonly errors: ImportIssue[];
}
export class MasterDataImportError extends Error {
  constructor(readonly rows: readonly ImportPreviewRow[]) {
    super("IMPORT_INVALID");
  }
}
const ITEM_FIELDS: Record<string, number> = {
  code: 20,
  name: 200,
  nameAr: 200,
  unit: 20,
  reorderPoint: 24,
};
const PARTY_FIELDS: Record<string, number> = {
  name: 200,
  nameAr: 200,
  kind: 20,
  phone: 40,
  email: 200,
  vatNumber: 20,
  commercialRegistration: 50,
  streetName: 200,
  city: 100,
  postalCode: 20,
  countryCode: 2,
};
const key = (value: string): string => value.normalize("NFKC").trim().toLowerCase();
const identityColumns = {
  code: Prisma.sql`code`,
  name: Prisma.sql`name`,
  email: Prisma.sql`email`,
  vatNumber: Prisma.sql`vat_number`,
  commercialRegistration: Prisma.sql`commercial_registration`,
};

export function validateImportRows(
  kind: ImportKind,
  rows: readonly ImportRow[],
): ImportPreviewRow[] {
  if (!rows.length || rows.length > 200) throw new MasterDataImportError([]);
  const fields = kind === "items" ? ITEM_FIELDS : PARTY_FIELDS;
  const required = kind === "items" ? ["code", "name", "unit"] : ["name", "kind"];
  const seen = new Map<string, ImportPreviewRow>();
  return rows.map((row) => {
    const result: ImportPreviewRow = { rowNumber: row.rowNumber, values: {}, errors: [] };
    for (const [field, value] of Object.entries(row.values)) {
      if (!Object.hasOwn(fields, field)) {
        result.errors.push({ field, code: "UNKNOWN_COLUMN" });
        continue;
      }
      if (typeof value !== "string") {
        result.errors.push({ field, code: "TEXT_REQUIRED" });
        continue;
      }
      const text = value.trim();
      if (text.length > fields[field]!) result.errors.push({ field, code: "TOO_LONG" });
      if (text) result.values[field] = text;
    }
    for (const field of required)
      if (!result.values[field]) result.errors.push({ field, code: "REQUIRED" });
    if (
      kind === "items" &&
      result.values.reorderPoint &&
      !/^\d{1,15}(\.\d{1,4})?$/.test(result.values.reorderPoint)
    )
      result.errors.push({ field: "reorderPoint", code: "INVALID_DECIMAL" });
    if (kind === "parties") {
      if (result.values.kind && !["COMPANY", "PERSON", "OTHER"].includes(result.values.kind))
        result.errors.push({ field: "kind", code: "INVALID_KIND" });
      if (result.values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.values.email))
        result.errors.push({ field: "email", code: "INVALID_EMAIL" });
      if (result.values.countryCode && !/^[A-Za-z]{2}$/.test(result.values.countryCode))
        result.errors.push({ field: "countryCode", code: "INVALID_COUNTRY" });
    }
    for (const field of kind === "items"
      ? ["code"]
      : ["name", "email", "vatNumber", "commercialRegistration"]) {
      const value = result.values[field];
      if (!value) continue;
      const identity = `${field}:${key(value)}`;
      const previous = seen.get(identity);
      if (previous) {
        result.errors.push({ field, code: "DUPLICATE_FILE" });
        if (!previous.errors.some((x) => x.field === field && x.code === "DUPLICATE_FILE"))
          previous.errors.push({ field, code: "DUPLICATE_FILE" });
      } else seen.set(identity, result);
    }
    return result;
  });
}

export class MasterDataImportService {
  constructor(private readonly prisma: PrismaClient) {}

  async preview(
    companyId: string,
    kind: ImportKind,
    rows: readonly ImportRow[],
    db: TransactionClient = this.prisma,
  ): Promise<ImportPreviewRow[]> {
    const result = validateImportRows(kind, rows);
    // Batch identity checks include inactive records. Bound results to the submitted identities.
    const identities =
      kind === "items" ? ["code"] : ["name", "email", "vatNumber", "commercialRegistration"];
    const matches = new Map<string, Set<string>>();
    for (const field of identities) {
      const values = [
        ...new Set(result.map((row) => row.values[field]).filter((v): v is string => !!v)),
      ];
      if (!values.length) continue;
      const column = identityColumns[field as keyof typeof identityColumns];
      const table = kind === "items" ? Prisma.sql`items` : Prisma.sql`parties`;
      const records = await db.$queryRaw<{ identity: string }[]>(
        Prisma.sql`SELECT DISTINCT lower(btrim(${column})) AS identity FROM ${table} WHERE company_id = ${companyId} AND lower(btrim(${column})) IN (${Prisma.join(values.map((v) => v.trim().toLowerCase()))}) LIMIT 200`,
      );
      matches.set(field, new Set(records.map((record) => key(record.identity))));
    }
    for (const row of result) {
      for (const field of identities)
        if (row.values[field] && matches.get(field)?.has(key(row.values[field])))
          row.errors.push({ field, code: "DUPLICATE_EXISTING" });
    }
    return result;
  }

  async commit(
    kind: ImportKind,
    rows: readonly ImportRow[],
    actor: { id: string; companyId: string },
    correlationId: string,
  ): Promise<{ imported: number }> {
    // Revalidate inside the transaction, including duplicates added after the preview.
    // Serializable isolation makes concurrent imports fail rather than create duplicate parties.
    return this.prisma.$transaction(
      async (tx) => {
        const preview = await this.preview(actor.companyId, kind, rows, tx);
        if (preview.some((row) => row.errors.length)) throw new MasterDataImportError(preview);
        const audit = new PrismaAuditLogger(tx);
        for (const row of preview) {
          const v = row.values;
          const id = newId();
          const ref = await allocateRef(tx, actor.companyId, kind === "items" ? "item" : "party");
          if (kind === "items") {
            await tx.item.create({
              data: {
                id,
                ref,
                companyId: actor.companyId,
                code: v.code!,
                name: v.name!,
                nameAr: v.nameAr ?? null,
                unit: v.unit!,
                reorderPoint: v.reorderPoint ?? "0",
                createdBy: actor.id,
                updatedBy: actor.id,
              },
            });
          } else {
            await tx.party.create({
              data: {
                id,
                ref,
                companyId: actor.companyId,
                name: v.name!,
                kind: v.kind!,
                nameAr: v.nameAr ?? null,
                phone: v.phone ?? null,
                email: v.email ?? null,
                vatNumber: v.vatNumber ?? null,
                commercialRegistration: v.commercialRegistration ?? null,
                streetName: v.streetName ?? null,
                city: v.city ?? null,
                postalCode: v.postalCode ?? null,
                countryCode: v.countryCode?.toUpperCase() ?? null,
                createdBy: actor.id,
                updatedBy: actor.id,
              },
            });
          }
          await audit.log({
            actorId: actor.id,
            action: `${kind === "items" ? "item" : "party"}.imported`,
            entityType: kind === "items" ? "Item" : "Party",
            entityId: id,
            after: { rowNumber: row.rowNumber },
            correlationId,
          });
        }
        return { imported: preview.length };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
    );
  }
}
