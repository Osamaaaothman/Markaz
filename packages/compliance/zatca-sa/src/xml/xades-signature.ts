// Assembles the XAdES envelope (ext:UBLExtensions + cac:Signature) and the QR code, and splices
// both into buildBareInvoiceXml's output to produce the final, ZATCA-ready document. This is the
// "most likely to break" part the task spec itself warns about — every structural piece and
// encoding here was verified against the official SDK's own signed sample
// (docs/vendor/zatca/sdk/Data/Samples), not derived from memory:
//   - hashInvoiceXml (invoice-hash.ts) reproduces the real sample's own ds:Reference DigestValue
//     exactly (invoice-hash.spec.ts) — proves the canonicalization + hashing pipeline.
//   - buildQrBase64 (qr.ts) reproduces the real sample's own embedded QR byte-for-byte
//     (qr.spec.ts).
//   - signData/extractPublicKeyDer/extractCertificateSignatureDer (signing.ts) are verified
//     against the real sample's key, certificate, and certificate signature
//     (signing.spec.ts).
//   - xades-signature.spec.ts verifies this module's OWN output end to end: the SignedInfo it
//     builds, once canonicalized, produces a signature that verifies against its own public key,
//     and the final document's top-level element order matches a real signed sample.
//
// One field could not be cross-checked: the official sample's own xades:CertDigest does not
// match SHA-256 of its own embedded ds:X509Certificate (a sample-data inconsistency, not
// something this code can resolve) — see docs/01-OPEN-DECISIONS.md section T. This module
// computes CertDigest the spec-correct way (the hash of the actual certificate bytes).
import { X509Certificate } from "node:crypto";
import { canonicalizeElementByLocalName } from "./canonicalize.js";
import { hashCanonicalBytes, hashInvoiceXml, zatcaHashOf, type InvoiceHash } from "./invoice-hash.js";
import { buildQrBase64, type QrFields } from "./qr.js";
import { extractCertificateSignatureDer, extractPublicKeyDer, signData, toPem } from "./signing.js";
import { escapeXml } from "./xml-escape.js";

const DS_NS = "http://www.w3.org/2000/09/xmldsig#";

export interface SigningContext {
  readonly certificatePem: string; // the EGS's certificate, PEM or raw base64 DER
  readonly privateKeyPem: string; // the EGS's private key, PEM or raw base64 (SEC1) DER
  readonly signingTime: string; // ISO 8601 without a timezone suffix, e.g. "2026-11-04T12:21:28"
  readonly isSimplified: boolean; // whether to include QR tag 9 (certificate signature)
  readonly qr: Pick<QrFields, "sellerName" | "vatNumber" | "timestamp" | "invoiceTotalWithVat" | "vatTotal">;
}

export interface SignedInvoice {
  readonly signedXml: string;
  readonly invoiceHash: InvoiceHash;
  readonly qrBase64: string;
  readonly signatureBase64: string;
}

// The certificate's issuer, in the "CN=..., DC=..., DC=..." form ds:X509IssuerName needs — the
// reverse of, and comma-joined rather than newline-joined, what X509Certificate.issuer returns.
// Verified against the official sample certificate's own IssuerSerial.
function issuerDistinguishedName(cert: X509Certificate): string {
  return cert.issuer.split("\n").reverse().join(", ");
}

function serialNumberDecimal(cert: X509Certificate): string {
  return BigInt(`0x${cert.serialNumber}`).toString(10);
}

function buildSignedProperties(cert: X509Certificate, signingTime: string): string {
  const certDigest = zatcaHashOf(cert.raw);
  return (
    `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" xmlns:ds="${DS_NS}" Id="xadesSignedProperties">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${escapeXml(signingTime)}</xades:SigningTime>` +
    `<xades:SigningCertificate><xades:Cert>` +
    `<xades:CertDigest><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${certDigest}</ds:DigestValue></xades:CertDigest>` +
    `<xades:IssuerSerial><ds:X509IssuerName>${escapeXml(issuerDistinguishedName(cert))}</ds:X509IssuerName><ds:X509SerialNumber>${serialNumberDecimal(cert)}</ds:X509SerialNumber></xades:IssuerSerial>` +
    `</xades:Cert></xades:SigningCertificate>` +
    `</xades:SignedSignatureProperties>` +
    `</xades:SignedProperties>`
  );
}

function buildSignedInfo(invoiceDigestBase64: string, signedPropertiesDigestZatcaForm: string): string {
  const xpathTransforms = [
    "not(//ancestor-or-self::ext:UBLExtensions)",
    "not(//ancestor-or-self::cac:Signature)",
    "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])",
  ]
    .map((xpath) => `<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>${escapeXml(xpath)}</ds:XPath></ds:Transform>`)
    .join("");
  return (
    `<ds:SignedInfo xmlns:ds="${DS_NS}">` +
    `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>` +
    `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>` +
    `<ds:Reference Id="invoiceSignedData" URI="">` +
    `<ds:Transforms>${xpathTransforms}<ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${invoiceDigestBase64}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${signedPropertiesDigestZatcaForm}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`
  );
}

// Builds the complete ext:UBLExtensions block + the ds:Signature it wraps, and signs it. Returns
// the extension XML plus the signature value (reused verbatim as the QR code's tag 7).
function buildSignatureExtension(invoiceHash: InvoiceHash, cert: X509Certificate, certificateBase64: string, privateKeyPem: string, signingTime: string): { extensionXml: string; signatureBase64: string } {
  const signedPropertiesXml = buildSignedProperties(cert, signingTime);
  const signedPropertiesDigest = hashCanonicalBytes(canonicalizeElementByLocalName(signedPropertiesXml, "http://uri.etsi.org/01903/v1.3.2#", "SignedProperties")).zatcaHash;

  const signedInfoXml = buildSignedInfo(invoiceHash.xmldsigBase64, signedPropertiesDigest);
  const canonicalSignedInfo = canonicalizeElementByLocalName(signedInfoXml, DS_NS, "SignedInfo");
  const signatureBuffer = signData(Buffer.from(canonicalSignedInfo, "utf8"), privateKeyPem);
  const signatureBase64 = signatureBuffer.toString("base64");

  const signature =
    `<ds:Signature xmlns:ds="${DS_NS}" Id="signature">` +
    signedInfoXml +
    `<ds:SignatureValue>${signatureBase64}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certificateBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `<ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">${signedPropertiesXml}</xades:QualifyingProperties></ds:Object>` +
    `</ds:Signature>`;

  const extensionXml =
    `<ext:UBLExtensions>` +
    `<ext:UBLExtension><ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>` +
    `<ext:ExtensionContent>` +
    `<sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">` +
    `<sac:SignatureInformation><cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>` +
    `<sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>` +
    signature +
    `</sac:SignatureInformation>` +
    `</sig:UBLDocumentSignatures>` +
    `</ext:ExtensionContent>` +
    `</ext:UBLExtension>` +
    `</ext:UBLExtensions>`;

  return { extensionXml, signatureBase64 };
}

const SIGNATURE_PLACEHOLDER =
  `<cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>` +
  `<cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod></cac:Signature>`;

// Hashes, signs, and finalizes a bare invoice (buildBareInvoiceXml's output): inserts
// ext:UBLExtensions (first child of the root), cac:Signature and the QR AdditionalDocumentReference
// (both right after the PIH reference, before AccountingSupplierParty) — the exact positions the
// official samples use.
export function signInvoiceXml(bareXml: string, context: SigningContext): SignedInvoice {
  const certificatePem = toPem(context.certificatePem, "CERTIFICATE");
  const certificateBase64 = certificatePem
    .split("\n")
    .filter((line) => !line.startsWith("-----"))
    .join("");
  const cert = new X509Certificate(certificatePem);

  const invoiceHash = hashInvoiceXml(bareXml);
  const { extensionXml, signatureBase64 } = buildSignatureExtension(invoiceHash, cert, certificateBase64, toPem(context.privateKeyPem, "EC PRIVATE KEY"), context.signingTime);

  const qrBase64 = buildQrBase64({
    ...context.qr,
    invoiceHashBase64: invoiceHash.xmldsigBase64,
    signatureBase64,
    publicKeyDer: extractPublicKeyDer(certificatePem),
    certificateSignatureDer: context.isSimplified ? extractCertificateSignatureDer(cert.raw) : undefined,
  });

  const qrReference = `<cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qrBase64}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>`;

  const rootOpenTagEnd = bareXml.indexOf(">", bareXml.indexOf("<Invoice")) + 1;
  const pihEnd = bareXml.indexOf("</cac:AdditionalDocumentReference>", bareXml.indexOf("<cbc:ID>PIH</cbc:ID>")) + "</cac:AdditionalDocumentReference>".length;

  const signedXml = bareXml.slice(0, rootOpenTagEnd) + extensionXml + bareXml.slice(rootOpenTagEnd, pihEnd) + qrReference + SIGNATURE_PLACEHOLDER + bareXml.slice(pihEnd);

  return { signedXml, invoiceHash, qrBase64, signatureBase64 };
}
