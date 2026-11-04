import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBareInvoiceXml } from "./invoice-xml-builder.js";
import type { ZatcaInvoiceInput, ZatcaParty } from "./invoice-xml.types.js";
import { verifyData } from "./signing.js";
import { signInvoiceXml } from "./xades-signature.js";
import { canonicalizeElementByLocalName } from "./canonicalize.js";

const SDK_ROOT = join(__dirname, "..", "..", "..", "..", "..", "docs", "vendor", "zatca", "sdk");
const SDK_CERTS = join(SDK_ROOT, "Data", "Certificates");
const SDK_SAMPLES = join(SDK_ROOT, "Data", "Samples");
const describeIfSdk = existsSync(SDK_CERTS) ? describe : describe.skip;

function topLevelChildTags(xml: string): string[] {
  const withoutDecl = xml.replace(/<\?xml[^?]*\?>/, "");
  const tags: string[] = [];
  let depth = -1;
  const re = /<(\/?)([a-zA-Z0-9:]+)[^>]*?(\/)?>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(withoutDecl))) {
    const closing = match[1] === "/";
    const name = match[2]!;
    const selfClosing = match[3] === "/";
    if (depth === -1) {
      depth = 0;
      continue;
    }
    if (closing) depth--;
    else {
      if (depth === 0 && !selfClosing) tags.push(name);
      if (!selfClosing) depth++;
    }
  }
  return tags;
}

describeIfSdk("signInvoiceXml — verified against the official SDK's sample key and certificate", () => {
  const certificatePem = readFileSync(join(SDK_CERTS, "cert.pem"), "utf8");
  const privateKeyPem = readFileSync(join(SDK_CERTS, "ec-secp256k1-priv-key.pem"), "utf8");

  const supplier: ZatcaParty = {
    partyIdentification: { schemeId: "CRN", id: "1010010000" },
    address: { streetName: "Prince Sultan", buildingNumber: "2322", citySubdivisionName: "Al-Murabba", cityName: "Riyadh", postalZone: "23333", countryCode: "SA" },
    vatNumber: "399999999900003",
    registrationName: "Maximum Speed Tech Supply LTD",
  };
  const customer: ZatcaParty = {
    address: { streetName: "Salah Al-Din", buildingNumber: "1111", citySubdivisionName: "Al-Murooj", cityName: "Riyadh", postalZone: "12222", countryCode: "SA" },
    vatNumber: "399999999800003",
    registrationName: "Fatoora Samples LTD",
  };
  const invoice: ZatcaInvoiceInput = {
    subtype: "STANDARD",
    documentType: "INVOICE",
    id: "SME00023",
    uuid: "8d487816-70b8-4ade-a618-9d620b73814a",
    issueDate: "2026-11-04",
    issueTime: "12:21:28",
    currency: "SAR",
    icv: "23",
    previousInvoiceHash: "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==",
    supplier,
    customer,
    actualDeliveryDate: "2026-11-04",
    paymentMeansCode: "10",
    lines: [{ id: "1", quantity: "2.000000", unitCode: "PCE", lineExtensionAmount: "4.00", taxAmount: "0.60", itemName: "قلم رصاص", taxCategoryId: "S", taxPercent: "15.00", priceAmount: "2.00" }],
  };

  const bareXml = buildBareInvoiceXml(invoice);
  const result = signInvoiceXml(bareXml, {
    certificatePem,
    privateKeyPem,
    signingTime: "2026-11-04T12:21:28",
    isSimplified: false,
    qr: { sellerName: "Maximum Speed Tech Supply LTD", vatNumber: "399999999900003", timestamp: "2026-11-04T12:21:28", invoiceTotalWithVat: "4.60", vatTotal: "0.60" },
  });

  it("produces a document whose own SignedInfo, once canonicalized, verifies against the certificate's public key", () => {
    const signedInfoCanonical = canonicalizeElementByLocalName(result.signedXml, "http://www.w3.org/2000/09/xmldsig#", "SignedInfo");
    const cert = new X509Certificate(certificatePem.includes("BEGIN") ? certificatePem : `-----BEGIN CERTIFICATE-----\n${certificatePem.trim()}\n-----END CERTIFICATE-----\n`);
    const signatureBuffer = Buffer.from(result.signatureBase64, "base64");
    expect(verifyData(Buffer.from(signedInfoCanonical, "utf8"), signatureBuffer, cert.publicKey)).toBe(true);
  });

  it("reuses the SignedInfo signature verbatim as the QR code's tag 7", () => {
    const decoded = Buffer.from(result.qrBase64, "base64");
    let i = 0;
    let tag7: Buffer | undefined;
    while (i < decoded.length) {
      const tag = decoded[i]!;
      const len = decoded[i + 1]!;
      if (tag === 7) tag7 = decoded.subarray(i + 2, i + 2 + len);
      i += 2 + len;
    }
    expect(tag7?.toString("utf8")).toBe(result.signatureBase64);
  });

  it("places ext:UBLExtensions first, and cac:Signature plus the QR reference right after PIH, matching the real sample's top-level order", () => {
    const sample = readFileSync(join(SDK_SAMPLES, "Standard", "Invoice", "Standard_Invoice.xml"), "utf8");
    expect(topLevelChildTags(result.signedXml)).toEqual(topLevelChildTags(sample));
  });

  it("never duplicates or drops the invoice's own content while splicing in the signature", () => {
    expect(result.signedXml).toContain("<cbc:ID>SME00023</cbc:ID>");
    expect(result.signedXml).toContain("قلم رصاص");
    expect((result.signedXml.match(/<cac:InvoiceLine>/g) ?? []).length).toBe(1);
  });

  it("includes QR tag 9 (certificate signature) for a simplified invoice, and omits it for standard", () => {
    const parseTags = (buf: Buffer): number[] => {
      const tags: number[] = [];
      let i = 0;
      while (i < buf.length) {
        tags.push(buf[i]!);
        i += 2 + buf[i + 1]!;
      }
      return tags;
    };
    expect(parseTags(Buffer.from(result.qrBase64, "base64"))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const simplifiedBare = buildBareInvoiceXml({ ...invoice, subtype: "SIMPLIFIED", customer: undefined, actualDeliveryDate: undefined });
    const simplifiedResult = signInvoiceXml(simplifiedBare, {
      certificatePem,
      privateKeyPem,
      signingTime: "2026-11-04T12:21:28",
      isSimplified: true,
      qr: { sellerName: "Maximum Speed Tech Supply LTD", vatNumber: "399999999900003", timestamp: "2026-11-04T12:21:28", invoiceTotalWithVat: "4.60", vatTotal: "0.60" },
    });
    expect(parseTags(Buffer.from(simplifiedResult.qrBase64, "base64"))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
