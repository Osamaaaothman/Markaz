// Verifies a SIGNED invoice document the way a receiver (or ZATCA's own SDK `-validate`) checks
// its cryptographic envelope, using only what is inside the document:
//
//   1. the invoice hash: strip the three elements that are not covered (ext:UBLExtensions,
//      cac:Signature, the QR reference), canonicalize, SHA-256 -- must equal the signature's
//      ds:Reference DigestValue;
//   2. the signature: the canonicalized ds:SignedInfo must verify, with the embedded certificate's
//      public key, against ds:SignatureValue;
//   3. the signed properties digest and the certificate digest (xades:CertDigest);
//   4. the QR code: parses as TLV, carries the tags its subtype requires, and every value in it
//      equals the same fact in the XML (seller, VAT number, timestamp, totals, hash, signature,
//      public key, and for simplified invoices the certificate's own signature).
//
// This proves the document is internally consistent and correctly signed. It does NOT prove that
// ZATCA accepts it: the certificate's chain to ZATCA's CA, the schema/Schematron rules and the
// chain (ICV/PIH) position are checked by ZATCA, not here. See invoice-consistency.ts for the
// same caveat.
import { X509Certificate } from "node:crypto";
import { canonicalizeElementByLocalName } from "../xml/canonicalize.js";
import { hashCanonicalBytes, hashInvoiceXml, zatcaHashOf } from "../xml/invoice-hash.js";
import { parseQrTlv } from "../xml/qr.js";
import { extractCertificateSignatureDer, extractPublicKeyDer, toPem, verifyData } from "../xml/signing.js";
import { IssueCollector, type ValidationReport } from "./validation-report.js";
import { NS, children, firstDescendant, parseXml, textOf } from "./xml-reader.js";

// Removes exactly the three elements the invoice hash does not cover. String-level on purpose: a
// DOM round trip can change whitespace and namespace placement, and canonicalization is
// byte-sensitive. Valid for documents our own pipeline produced (compact, no whitespace between
// elements) and for the SDK's samples (which hash the same way -- invoice-hash.spec.ts).
export function stripSignatureElements(xml: string): string {
  return xml
    .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, "")
    .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, "")
    .replace(/<cac:AdditionalDocumentReference>\s*<cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, "");
}

export function verifySignedInvoice(signedXml: string): ValidationReport {
  const c = new IssueCollector();
  let doc: Document;
  try {
    doc = parseXml(signedXml);
  } catch (e) {
    c.error("NOT_WELL_FORMED", (e as Error).message);
    return c.report();
  }
  const root = doc.documentElement;

  const signature = firstDescendant(doc, "ds", "Signature");
  if (!signature) {
    c.error("SIGNATURE_MISSING", "The document has no ds:Signature");
    return c.report();
  }
  const signedInfo = firstDescendant(signature, "ds", "SignedInfo");
  const signatureValue = textOf(firstDescendant(signature, "ds", "SignatureValue"));
  const certBase64 = textOf(firstDescendant(signature, "ds", "X509Certificate"));
  if (!signedInfo || !signatureValue || !certBase64) {
    c.error("SIGNATURE_INCOMPLETE", "The signature lacks SignedInfo, SignatureValue or the X509Certificate");
    return c.report();
  }

  let cert: X509Certificate;
  try {
    cert = new X509Certificate(toPem(certBase64, "CERTIFICATE"));
  } catch {
    c.error("CERTIFICATE_UNREADABLE", "The embedded X509Certificate is not a valid certificate");
    return c.report();
  }

  // 1. invoice hash
  const references = Array.from(signedInfo.getElementsByTagNameNS(NS.ds, "Reference"));
  const invoiceRef = references.find((r) => r.getAttribute("URI") === "");
  const propsRef = references.find((r) => r.getAttribute("URI") === "#xadesSignedProperties");
  const invoiceDigest = invoiceRef ? textOf(firstDescendant(invoiceRef, "ds", "DigestValue")) : undefined;
  const propsDigest = propsRef ? textOf(firstDescendant(propsRef, "ds", "DigestValue")) : undefined;
  if (!invoiceDigest) c.error("INVOICE_REFERENCE_MISSING", 'SignedInfo has no Reference with URI=""');
  const recomputed = hashInvoiceXml(stripSignatureElements(signedXml));
  if (invoiceDigest && recomputed.xmldsigBase64 !== invoiceDigest) c.error("INVOICE_HASH_MISMATCH", "The invoice content does not match the digest the signature covers (the document was changed after signing, or was hashed differently)");

  // 2. signature over the canonicalized SignedInfo
  try {
    const canonicalSignedInfo = canonicalizeElementByLocalName(signedXml, NS.ds, "SignedInfo");
    if (!verifyData(Buffer.from(canonicalSignedInfo, "utf8"), Buffer.from(signatureValue, "base64"), cert.publicKey)) {
      c.error("SIGNATURE_INVALID", "ds:SignatureValue does not verify against the embedded certificate's public key");
    }
  } catch (e) {
    c.error("SIGNATURE_UNVERIFIABLE", `The signature could not be checked: ${(e as Error).message}`);
  }

  // 3. signed properties and certificate digests
  const signedProps = firstDescendant(signature, "xades", "SignedProperties");
  if (!signedProps) c.error("SIGNED_PROPERTIES_MISSING", "xades:SignedProperties is missing");
  else {
    const expected = hashCanonicalBytes(canonicalizeElementByLocalName(signedXml, NS.xades, "SignedProperties")).zatcaHash;
    if (!propsDigest) c.error("SIGNED_PROPERTIES_REFERENCE_MISSING", "SignedInfo has no Reference to #xadesSignedProperties");
    else if (propsDigest !== expected) c.error("SIGNED_PROPERTIES_DIGEST_MISMATCH", "The SignedProperties digest in SignedInfo does not match the SignedProperties element");
    const certDigest = textOf(firstDescendant(signedProps, "ds", "DigestValue"));
    if (certDigest !== zatcaHashOf(cert.raw)) c.error("CERT_DIGEST_MISMATCH", "xades:CertDigest is not the digest of the embedded certificate");
  }

  // 4. QR code
  const qrRef = children(root, "cac", "AdditionalDocumentReference").find((r) => textOf(children(r, "cbc", "ID")[0]) === "QR");
  const qrBase64 = qrRef ? textOf(firstDescendant(qrRef, "cbc", "EmbeddedDocumentBinaryObject")) : undefined;
  if (!qrBase64) {
    c.error("QR_MISSING", "The document has no QR reference");
    return c.report();
  }
  let tags: ReadonlyMap<number, Buffer>;
  try {
    tags = parseQrTlv(qrBase64);
  } catch (e) {
    c.error("QR_UNREADABLE", (e as Error).message);
    return c.report();
  }

  const typeName = root.getElementsByTagNameNS(NS.cbc, "InvoiceTypeCode")[0]?.getAttribute("name") ?? "";
  const simplified = typeName.startsWith("02");
  for (let tag = 1; tag <= 8; tag++) if (!tags.has(tag)) c.error("QR_TAG_MISSING", `QR tag ${tag} is missing`);
  if (simplified && !tags.has(9)) c.error("QR_TAG_MISSING", "QR tag 9 (certificate signature) is required on a simplified invoice");
  if (!simplified && tags.has(9)) c.warn("QR_TAG_UNEXPECTED", "QR tag 9 is present on a standard invoice");

  const text = (tag: number): string | undefined => tags.get(tag)?.toString("utf8");
  const seller = children(root, "cac", "AccountingSupplierParty")[0];
  const monetary = children(root, "cac", "LegalMonetaryTotal")[0];
  const expectedFacts: readonly [number, string, string | undefined][] = [
    [1, "seller name", seller ? textOf(firstDescendant(seller, "cbc", "RegistrationName")) : undefined],
    [2, "seller VAT number", seller ? textOf(firstDescendant(seller, "cbc", "CompanyID")) : undefined],
    [3, "timestamp", `${textOf(children(root, "cbc", "IssueDate")[0]) ?? ""}T${textOf(children(root, "cbc", "IssueTime")[0]) ?? ""}`],
    [4, "total with VAT", monetary ? textOf(children(monetary, "cbc", "TaxInclusiveAmount")[0]) : undefined],
    [5, "VAT total", textOf(children(children(root, "cac", "TaxTotal")[0] ?? root, "cbc", "TaxAmount")[0])],
    [6, "invoice hash", invoiceDigest],
    [7, "signature", signatureValue],
  ];
  for (const [tag, label, expected] of expectedFacts) {
    if (tags.has(tag) && text(tag) !== expected) c.error("QR_VALUE_MISMATCH", `QR tag ${tag} (${label}) is "${text(tag) ?? ""}" but the document says "${expected ?? ""}"`);
  }
  const publicKey = tags.get(8);
  if (publicKey && !publicKey.equals(extractPublicKeyDer(toPem(certBase64, "CERTIFICATE")))) c.error("QR_VALUE_MISMATCH", "QR tag 8 is not the embedded certificate's public key");
  const certSignature = tags.get(9);
  if (certSignature && !certSignature.equals(extractCertificateSignatureDer(cert.raw))) c.error("QR_VALUE_MISMATCH", "QR tag 9 is not the embedded certificate's own signature");

  return c.report();
}
