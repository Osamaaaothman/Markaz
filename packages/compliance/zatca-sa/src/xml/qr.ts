// The QR code's TLV (tag-length-value) payload — docs/06-COMPLIANCE-PACK-RULES.md §3 / the
// Security Features Standard. Tag byte encodings verified by decoding a REAL signed sample's own
// embedded QR (docs/vendor/zatca/sdk/Data/Samples), not assumed from the spec text alone — two
// tags turned out to be base64 rendered as UTF-8 TEXT (not the raw bytes the Security Standard's
// prose seems to describe), which qr.spec.ts's byte-for-byte reproduction of the real sample
// proves conclusively:
//
//   1 seller name          UTF-8 text
//   2 VAT number            UTF-8 text
//   3 timestamp (ISO 8601)  UTF-8 text
//   4 invoice total w/ VAT  UTF-8 text (a decimal string, e.g. "4.60" — NOT a binary number)
//   5 VAT total             UTF-8 text
//   6 invoice hash           UTF-8 text of base64(raw SHA-256 digest) — i.e. InvoiceHash.xmldsigBase64
//                            AS A STRING, not the 32 raw bytes
//   7 ECDSA signature       UTF-8 text of base64(DER-encoded ECDSA signature)
//   8 EC public key          RAW bytes: the DER SubjectPublicKeyInfo (not base64/text)
//   9 certificate signature RAW bytes: the DER ECDSA signature from the EGS certificate's own
//                            signature field (simplified invoices only — absent for standard)
export interface QrFields {
  readonly sellerName: string;
  readonly vatNumber: string;
  readonly timestamp: string; // ISO 8601, e.g. "2026-11-04T12:21:28"
  readonly invoiceTotalWithVat: string;
  readonly vatTotal: string;
  readonly invoiceHashBase64: string; // InvoiceHash.xmldsigBase64 — base64 of the raw digest
  readonly signatureBase64: string; // base64 of the DER ECDSA signature
  readonly publicKeyDer: Buffer; // DER SubjectPublicKeyInfo, raw
  // Simplified invoices only: the DER signature from the EGS certificate's own signature field.
  readonly certificateSignatureDer?: Buffer | undefined;
}

function tlv(tag: number, value: Buffer): Buffer {
  if (value.length > 255) {
    throw new RangeError(`QR tag ${tag}'s value is ${value.length} bytes — TLV length is a single byte, max 255`);
  }
  return Buffer.concat([Buffer.from([tag, value.length]), value]);
}

function textTlv(tag: number, value: string): Buffer {
  return tlv(tag, Buffer.from(value, "utf8"));
}

export function buildQrTlv(fields: QrFields): Buffer {
  const parts = [
    textTlv(1, fields.sellerName),
    textTlv(2, fields.vatNumber),
    textTlv(3, fields.timestamp),
    textTlv(4, fields.invoiceTotalWithVat),
    textTlv(5, fields.vatTotal),
    textTlv(6, fields.invoiceHashBase64),
    textTlv(7, fields.signatureBase64),
    tlv(8, fields.publicKeyDer),
  ];
  if (fields.certificateSignatureDer) {
    parts.push(tlv(9, fields.certificateSignatureDer));
  }
  return Buffer.concat(parts);
}

export function buildQrBase64(fields: QrFields): string {
  return buildQrTlv(fields).toString("base64");
}
