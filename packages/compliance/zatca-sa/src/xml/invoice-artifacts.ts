import { children, firstDescendant, parseXml, textOf } from "../validation/xml-reader.js";
import { parseQrTlv } from "./qr.js";

/** Read document-level values only; a nested reference must not impersonate the invoice. */
export function readInvoiceArtifacts(xml: string): { uuid: string; simplified: boolean; qr: string | null } {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Invoice entities are not supported");
  const root = parseXml(xml).documentElement;
  if (root.localName !== "Invoice" || root.namespaceURI !== "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2") throw new Error("Expected a UBL invoice");
  const uuids = children(root, "cbc", "UUID");
  const uuid = textOf(uuids[0]);
  if (uuids.length !== 1 || !uuid) throw new Error("Invoice UUID is missing or ambiguous");
  const type = children(root, "cbc", "InvoiceTypeCode")[0]?.getAttribute("name");
  if (!type || !/^(01|02)/.test(type)) throw new Error("Invoice subtype is missing");
  const references = children(root, "cac", "AdditionalDocumentReference").filter((ref) => textOf(children(ref, "cbc", "ID")[0]) === "QR");
  if (references.length > 1) throw new Error("Ambiguous invoice QR");
  const qr = references[0] ? textOf(firstDescendant(references[0], "cbc", "EmbeddedDocumentBinaryObject")) ?? null : null;
  if (qr) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(qr)) throw new Error("Invalid QR encoding");
    const tags = parseQrTlv(qr);
    for (const tag of [1, 2, 3, 4, 5, 6, 7, 8, ...(type.startsWith("02") ? [9] : [])]) {
      if (!tags.get(tag)?.length) throw new Error(`Missing QR field ${tag}`);
    }
  }
  return { uuid, simplified: type.startsWith("02"), qr };
}

/** Standard invoices must display the authority's QR, never the pre-clearance one. */
export function invoiceQrArtifact(signedXml: string | null, clearedXml: string | null): { qr: string; source: "SIGNED" | "CLEARED" } | null {
  if (!signedXml) return null;
  try {
    const signed = readInvoiceArtifacts(signedXml);
    if (signed.simplified) return signed.qr ? { qr: signed.qr, source: "SIGNED" } : null;
    if (!clearedXml) return null;
    const cleared = readInvoiceArtifacts(clearedXml);
    // Sandbox can return a canned document belonging to a different invoice.
    if (cleared.uuid !== signed.uuid || cleared.simplified || !cleared.qr) return null;
    if (!signed.qr || !parseQrTlv(cleared.qr).get(6)?.equals(parseQrTlv(signed.qr).get(6)!)) return null;
    return { qr: cleared.qr, source: "CLEARED" };
  } catch {
    return null;
  }
}
