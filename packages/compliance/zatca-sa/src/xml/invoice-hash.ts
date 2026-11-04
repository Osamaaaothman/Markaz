// The single SHA-256 digest of a canonicalized ZATCA document, in the three different encodings
// the spec actually uses at different call sites — verified against the official SDK's own
// signed sample (invoice-hash.spec.ts reproduces its real ds:Reference/DigestValue exactly):
//
//   - `digest`        the raw 32 bytes. Nothing in the XML carries this form directly, but it is
//                      what every other form derives from.
//   - `xmldsigBase64`  base64(raw digest) — what XMLDSig's own DigestValue element, and the QR
//                      code's tag 6 ("XML Hash", as UTF-8 text of this string, not raw bytes —
//                      confirmed by decoding a real sample's QR), both actually contain.
//   - `zatcaHash`      base64(hex-string(raw digest)) — the double-encoded form ZATCA's own
//                      business layer uses: the next invoice's PIH
//                      (EgsChainService.FIRST_INVOICE_PREVIOUS_HASH is this same formula seeded
//                      with "0"), and almost certainly `ZatcaInvoiceRecord.invoiceHash` and the
//                      xades:SignedProperties / certificate digests (same double-encoding,
//                      confirmed by decoding the real sample's SignedProperties DigestValue).
import { createHash } from "node:crypto";
import { canonicalizeXml } from "./canonicalize.js";

export interface InvoiceHash {
  readonly digest: Buffer;
  readonly xmldsigBase64: string;
  readonly zatcaHash: string;
}

function hashToForms(digest: Buffer): InvoiceHash {
  return {
    digest,
    xmldsigBase64: digest.toString("base64"),
    zatcaHash: Buffer.from(digest.toString("hex"), "utf8").toString("base64"),
  };
}

// Hashes already-canonicalized bytes (e.g. a canonicalized ds:SignedInfo fragment, which must be
// hashed as-is, never re-canonicalized).
export function hashCanonicalBytes(canonical: string): InvoiceHash {
  return hashToForms(createHash("sha256").update(canonical, "utf8").digest());
}

// Canonicalizes and hashes a whole document (or the signature-unrelated case of hashing a bare
// invoice, i.e. buildBareInvoiceXml's output).
export function hashInvoiceXml(xml: string): InvoiceHash {
  return hashCanonicalBytes(canonicalizeXml(xml));
}

// `zatcaHash` applied to arbitrary bytes, not a digest this module computed — used for the
// certificate digest (xades:CertDigest), which hashes the DER certificate bytes directly, not a
// canonicalized XML fragment.
export function zatcaHashOf(data: Buffer): string {
  return hashToForms(createHash("sha256").update(data).digest()).zatcaHash;
}
