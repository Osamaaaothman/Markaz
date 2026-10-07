// What may be attached, to what, and how the bytes are checked. Pure and framework-free so the rules are
// unit-testable and the SQL CHECK constraints in migration 20261009090000 can be compared with them.

export const OWNER_TYPES = ["SALES_INVOICE", "SUPPLIER_INVOICE", "PAYMENT", "JOURNAL_ENTRY", "PURCHASE_ORDER", "PARTY", "ITEM"] as const;
export type AttachmentOwnerType = (typeof OWNER_TYPES)[number];

export type AttachmentVisibility = "PRIVATE" | "PUBLIC";

interface OwnerRule {
  // The permission needed to see the record itself: nobody reads a scan of an invoice they cannot open.
  readonly readResource: string;
  readonly visibility: AttachmentVisibility;
}

// Everything is PRIVATE except pictures of items. This table is the single place that decides visibility —
// a caller never chooses it, so a user cannot publish an invoice by mistake. The same rule is a CHECK in the
// database (attachments_public_only_items_check). New owner types default to private: add them here deliberately.
export const OWNER_RULES: Readonly<Record<AttachmentOwnerType, OwnerRule>> = {
  SALES_INVOICE: { readResource: "sales_invoice", visibility: "PRIVATE" },
  SUPPLIER_INVOICE: { readResource: "supplier_invoice", visibility: "PRIVATE" },
  PAYMENT: { readResource: "payment", visibility: "PRIVATE" },
  JOURNAL_ENTRY: { readResource: "journal_entry", visibility: "PRIVATE" },
  PURCHASE_ORDER: { readResource: "purchase_order", visibility: "PRIVATE" },
  PARTY: { readResource: "party", visibility: "PRIVATE" },
  ITEM: { readResource: "item", visibility: "PUBLIC" },
};

export function isOwnerType(value: string): value is AttachmentOwnerType {
  return (OWNER_TYPES as readonly string[]).includes(value);
}

export type AttachmentContentType = "application/pdf" | "image/png" | "image/jpeg" | "image/webp";

export const CONTENT_TYPE_EXTENSIONS: Readonly<Record<AttachmentContentType, string>> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Only PDF and the three common image formats. A picture of a bill or a scanned PDF covers the real need;
// every extra format is extra attack surface (docs/09-SECURITY-RULES.md §4).
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
// The database CHECK allows up to this; the configured limit may be lower, never higher.
export const HARD_MAX_BYTES = 50 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  signature.every((value, index) => bytes[offset + index] === value);

// The real type of the file from its first bytes. The extension and the browser's Content-Type header are
// supplied by the sender and are never trusted: a script renamed to .pdf is rejected here.
export function detectContentType(bytes: Uint8Array): AttachmentContentType | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp"; // RIFF....WEBP
  return null;
}

// A name for display and for the download header only. It is never used to build a storage path.
// Path separators, control characters and bidi overrides are removed; the result is never empty.
export function sanitizeFileName(raw: string, fallbackExtension: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩"<>:|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : `document.${fallbackExtension}`;
}

// A key nobody can guess or build from user input: a two-character shard folder (the last two characters of the
// random id, so files spread evenly) and a random UUID. No company id (a company id is not guaranteed to be a UUID),
// no name, no extension. Which company owns the file is the database row, never the path.
export const STORAGE_KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newStorageKey(fileId: string): string {
  return `${fileId.slice(-2)}/${fileId}`;
}
