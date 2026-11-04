import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hashInvoiceXml } from "./invoice-hash.js";

const SDK_SAMPLES = join(__dirname, "..", "..", "..", "..", "..", "docs", "vendor", "zatca", "sdk", "Data", "Samples");
const describeIfSdk = existsSync(SDK_SAMPLES) ? describe : describe.skip;

function stripPhase4Elements(xml: string): string {
  return xml
    .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, "")
    .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, "")
    .replace(/<cac:AdditionalDocumentReference>\s*<cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, "");
}

describe("hashInvoiceXml", () => {
  it("produces a stable digest for the same input, and a different one for different input", () => {
    const a = hashInvoiceXml("<Invoice xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:Invoice-2\"><cbc:ID xmlns:cbc=\"urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2\">1</cbc:ID></Invoice>");
    const b = hashInvoiceXml("<Invoice xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:Invoice-2\"><cbc:ID xmlns:cbc=\"urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2\">1</cbc:ID></Invoice>");
    expect(a.xmldsigBase64).toBe(b.xmldsigBase64);
    const c = hashInvoiceXml("<Invoice xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:Invoice-2\"><cbc:ID xmlns:cbc=\"urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2\">2</cbc:ID></Invoice>");
    expect(a.xmldsigBase64).not.toBe(c.xmldsigBase64);
  });

  it("derives zatcaHash as base64(hex(digest)), the same double-encoding as the PIH", () => {
    const h = hashInvoiceXml("<Invoice xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:Invoice-2\"/>");
    expect(Buffer.from(h.zatcaHash, "base64").toString("utf8")).toBe(h.digest.toString("hex"));
    expect(h.xmldsigBase64).toBe(h.digest.toString("base64"));
  });
});

// The decisive verification: canonicalizing and hashing the official SDK's own bare (Phase-4-
// elements-stripped) sample must reproduce that SAME sample's own real ds:Reference/DigestValue
// — the one ZATCA itself accepted when this invoice was actually cleared. If this passes, the
// canonicalization choice (xml-crypto's C14N 1.0 standing in for the sample's declared C14N 1.1 —
// see canonicalize.ts) and this module's hashing are both proven correct end to end, not just
// argued to be equivalent.
describeIfSdk("hashInvoiceXml — reproduces the official SDK sample's own signed digest", () => {
  it("matches Standard_Invoice.xml's ds:Reference DigestValue", () => {
    const sample = readFileSync(join(SDK_SAMPLES, "Standard", "Invoice", "Standard_Invoice.xml"), "utf8");
    const bare = stripPhase4Elements(sample);
    const hash = hashInvoiceXml(bare);
    expect(hash.xmldsigBase64).toBe("V4U5qlZ3yXQ/Si1AC/R8SLc3F+iNy27wdVe8IWRqFAQ=");
  });

  it("matches Simplified_Invoice.xml's ds:Reference DigestValue", () => {
    const sample = readFileSync(join(SDK_SAMPLES, "Simplified", "Invoice", "Simplified_Invoice.xml"), "utf8");
    const bare = stripPhase4Elements(sample);
    const hash = hashInvoiceXml(bare);
    expect(hash.xmldsigBase64).toBe("z5F9qsS6oWyDhehD8u8S0DaxV+2CUiUz9Y+UsR61JgQ=");
  });
});
