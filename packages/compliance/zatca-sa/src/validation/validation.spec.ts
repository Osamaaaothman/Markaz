import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildBareInvoiceXml } from "../xml/invoice-xml-builder.js";
import type { ZatcaDocumentType, ZatcaInvoiceInput, ZatcaInvoiceSubtype, ZatcaParty } from "../xml/invoice-xml.types.js";
import { signInvoiceXml } from "../xml/xades-signature.js";
import { SDK_SAMPLES, describeIfSdk, generateTestCertificate } from "../testing/fixtures.js";
import { checkInvoiceConsistency } from "./invoice-consistency.js";
import { stripSignatureElements, verifySignedInvoice } from "./signed-invoice-verifier.js";
import type { ValidationReport } from "./validation-report.js";

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
const PIH = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

// Two tax groups on purpose: 15% standard and a zero-rated line with an exemption reason, so the
// per-category breakdown is genuinely exercised.
function makeInput(subtype: ZatcaInvoiceSubtype, documentType: ZatcaDocumentType, overrides: Partial<ZatcaInvoiceInput> = {}): ZatcaInvoiceInput {
  return {
    subtype,
    documentType,
    id: "INV-2026-000001",
    uuid: "8d487816-70b8-4ade-a618-9d620b73814a",
    issueDate: "2026-11-04",
    issueTime: "12:21:28",
    currency: "SAR",
    icv: "23",
    previousInvoiceHash: PIH,
    supplier,
    customer: subtype === "STANDARD" ? customer : undefined,
    paymentMeansCode: "10",
    ...(documentType !== "INVOICE" ? { billingReference: { invoiceId: "INV-2026-000000" }, instructionNote: "Goods returned" } : {}),
    lines: [
      { id: "1", quantity: "2.000000", unitCode: "PCE", lineExtensionAmount: "4.00", taxAmount: "0.60", itemName: "Pencil", taxCategoryId: "S", taxPercent: "15.00", priceAmount: "2.00" },
      { id: "2", quantity: "1.000000", unitCode: "PCE", lineExtensionAmount: "10.00", taxAmount: "0.00", itemName: "Medicine", taxCategoryId: "Z", taxPercent: "0.00", exemptionReasonCode: "VATEX-SA-34-4", exemptionReason: "Qualifying medicines", priceAmount: "10.00" },
    ],
    ...overrides,
  };
}

const cert = generateTestCertificate();

function sign(input: ZatcaInvoiceInput, qrOverrides: { vatTotal?: string; sellerName?: string } = {}): { bare: string; signed: string } {
  const bare = buildBareInvoiceXml(input);
  const { signedXml } = signInvoiceXml(bare, {
    certificatePem: cert.certificatePem,
    privateKeyPem: cert.privateKeyPem,
    signingTime: `${input.issueDate}T${input.issueTime}`,
    isSimplified: input.subtype === "SIMPLIFIED",
    qr: {
      sellerName: qrOverrides.sellerName ?? input.supplier.registrationName,
      vatNumber: input.supplier.vatNumber ?? "",
      timestamp: `${input.issueDate}T${input.issueTime}`,
      invoiceTotalWithVat: "14.60",
      vatTotal: qrOverrides.vatTotal ?? "0.60",
    },
  });
  return { bare, signed: signedXml };
}

const codes = (r: ValidationReport): string[] => r.issues.filter((i) => i.severity === "error").map((i) => i.code);

describe("every Tier 1 document type: built, signed, and checked", () => {
  const combos: [ZatcaInvoiceSubtype, ZatcaDocumentType][] = [
    ["STANDARD", "INVOICE"],
    ["STANDARD", "CREDIT_NOTE"],
    ["STANDARD", "DEBIT_NOTE"],
    ["SIMPLIFIED", "INVOICE"],
    ["SIMPLIFIED", "CREDIT_NOTE"],
    ["SIMPLIFIED", "DEBIT_NOTE"],
  ];

  it.each(combos)("%s %s passes the consistency checks and the signature/QR verification", (subtype, documentType) => {
    const { bare, signed } = sign(makeInput(subtype, documentType));
    expect(checkInvoiceConsistency(bare)).toEqual({ valid: true, issues: [] });
    expect(checkInvoiceConsistency(signed)).toEqual({ valid: true, issues: [] });
    expect(verifySignedInvoice(signed)).toEqual({ valid: true, issues: [] });
  });
});

describe("checkInvoiceConsistency — catches our own mistakes", () => {
  const bare = buildBareInvoiceXml(makeInput("STANDARD", "INVOICE"));

  it("flags a total with VAT that is not net plus tax (BR-CO-15)", () => {
    const broken = bare.replace('<cbc:TaxInclusiveAmount currencyID="SAR">14.60', '<cbc:TaxInclusiveAmount currencyID="SAR">14.61');
    expect(broken).not.toBe(bare);
    expect(codes(checkInvoiceConsistency(broken))).toContain("BR_CO_15");
  });

  it("flags a line amount that no longer adds up to the document total (BR-CO-10) and to its tax subtotal", () => {
    const broken = bare.replace('<cbc:LineExtensionAmount currencyID="SAR">4.00', '<cbc:LineExtensionAmount currencyID="SAR">5.00');
    const found = codes(checkInvoiceConsistency(broken));
    expect(found).toContain("BR_CO_10");
    expect(found).toContain("BR_CO_17_TAXABLE");
  });

  it("flags a document tax total that is not the sum of the line taxes (BR-CO-14)", () => {
    const broken = bare.replace(/<cac:TaxTotal><cbc:TaxAmount currencyID="SAR">0\.60<\/cbc:TaxAmount><\/cac:TaxTotal>/, '<cac:TaxTotal><cbc:TaxAmount currencyID="SAR">0.70</cbc:TaxAmount></cac:TaxTotal>');
    expect(broken).not.toBe(bare);
    expect(codes(checkInvoiceConsistency(broken))).toContain("BR_CO_14");
  });

  it("flags a missing ICV, a malformed PIH, and an invalid UUID", () => {
    const noIcv = bare.replace(/<cac:AdditionalDocumentReference><cbc:ID>ICV<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, "");
    expect(codes(checkInvoiceConsistency(noIcv))).toContain("ICV_INVALID");
    expect(codes(checkInvoiceConsistency(bare.replace(PIH, "AAAA")))).toContain("PIH_INVALID");
    expect(codes(checkInvoiceConsistency(bare.replace("8d487816-70b8-4ade-a618-9d620b73814a", "not-a-uuid")))).toContain("UUID_INVALID");
  });

  it("flags a credit note whose billing reference was lost", () => {
    const cn = buildBareInvoiceXml(makeInput("STANDARD", "CREDIT_NOTE")).replace(/<cac:BillingReference>[\s\S]*?<\/cac:BillingReference>/, "");
    expect(codes(checkInvoiceConsistency(cn))).toContain("BILLING_REFERENCE_MISSING");
  });

  it("flags a seller VAT number that is not 15 digits, and warns when it does not start and end with 3", () => {
    const short = buildBareInvoiceXml(makeInput("STANDARD", "INVOICE", { supplier: { ...supplier, vatNumber: "12345" } }));
    expect(codes(checkInvoiceConsistency(short))).toContain("SELLER_VAT_INVALID");
    const odd = checkInvoiceConsistency(buildBareInvoiceXml(makeInput("STANDARD", "INVOICE", { supplier: { ...supplier, vatNumber: "123456789012345" } })));
    expect(odd.valid).toBe(true);
    expect(odd.issues.map((i) => i.code)).toContain("SELLER_VAT_SHAPE");
  });

  it("flags a tax line that is not the stated rate of its net amount, as a warning only", () => {
    const input = makeInput("STANDARD", "INVOICE");
    const off = buildBareInvoiceXml({ ...input, lines: [{ ...input.lines[0]!, taxAmount: "0.90" }, input.lines[1]!] });
    const report = checkInvoiceConsistency(off);
    expect(report.issues.map((i) => i.code)).toContain("LINE_TAX_NOT_RATE_TIMES_NET");
    expect(report.issues.find((i) => i.code === "LINE_TAX_NOT_RATE_TIMES_NET")?.severity).toBe("warning");
  });

  it("reports malformed XML instead of throwing", () => {
    expect(codes(checkInvoiceConsistency("<Invoice><unclosed></Invoice>"))).toEqual(["NOT_WELL_FORMED"]);
  });
});

describe("verifySignedInvoice — catches tampering", () => {
  const { signed } = sign(makeInput("SIMPLIFIED", "INVOICE"));

  it("flags content changed after signing", () => {
    const tampered = signed.replace("<cbc:Name>Pencil</cbc:Name>", "<cbc:Name>Gold bar</cbc:Name>");
    expect(tampered).not.toBe(signed);
    expect(codes(verifySignedInvoice(tampered))).toContain("INVOICE_HASH_MISMATCH");
  });

  it("flags a signature value that was swapped", () => {
    const other = sign(makeInput("SIMPLIFIED", "INVOICE", { id: "INV-2026-000002" })).signed;
    const sigOf = (xml: string): string => /<ds:SignatureValue>([^<]+)</.exec(xml)![1]!;
    const tampered = signed.replace(sigOf(signed), sigOf(other));
    expect(codes(verifySignedInvoice(tampered))).toContain("SIGNATURE_INVALID");
  });

  it("flags a QR code that disagrees with the document", () => {
    const wrongQr = sign(makeInput("SIMPLIFIED", "INVOICE"), { vatTotal: "0.61" }).signed;
    expect(codes(verifySignedInvoice(wrongQr))).toContain("QR_VALUE_MISMATCH");
  });

  it("flags a document with no signature at all", () => {
    expect(codes(verifySignedInvoice(buildBareInvoiceXml(makeInput("SIMPLIFIED", "INVOICE"))))).toEqual(["SIGNATURE_MISSING"]);
  });

  it("flags a QR reference that was removed", () => {
    const noQr = signed.replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, "");
    expect(codes(verifySignedInvoice(noQr))).toContain("QR_MISSING");
  });
});

describe("stripSignatureElements", () => {
  it("returns exactly the bare document the builder produced", () => {
    const { bare, signed } = sign(makeInput("STANDARD", "INVOICE"));
    expect(stripSignatureElements(signed)).toBe(bare);
  });
});

function listXml(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listXml(full) : name.endsWith(".xml") ? [full] : [];
  });
}

// Run only where the official SDK is present. The sample documents are real signed invoices that
// ZATCA's own tooling produced and accepted, so our validators must AGREE with them: any error
// outside the documented allowance below is either a bug in a validator or a finding about the
// samples, and either way is worth reading. NOT run in the cloud session that wrote this (the SDK
// is not there) -- if it fails on a machine that has the SDK, read the failure, do not loosen it.
describeIfSdk("agrees with the official SDK sample documents", () => {
  // docs/01-OPEN-DECISIONS.md section U: the samples' own xades:CertDigest does not match their
  // own embedded certificate (sample-data inconsistency).
  const ALLOWED_SAMPLE_DEVIATIONS = new Set(["CERT_DIGEST_MISMATCH"]);
  const samples = listXml(SDK_SAMPLES);

  it("finds the samples", () => {
    expect(samples.length).toBeGreaterThanOrEqual(6);
  });

  it.each(samples.map((p) => [p.slice(SDK_SAMPLES.length + 1), p] as const))("%s", (_name, path) => {
    const xml = readFileSync(path, "utf8");
    const consistency = codes(checkInvoiceConsistency(xml));
    expect(consistency).toEqual([]);
    const crypto = codes(verifySignedInvoice(xml)).filter((c) => !ALLOWED_SAMPLE_DEVIATIONS.has(c));
    expect(crypto).toEqual([]);
  });
});
