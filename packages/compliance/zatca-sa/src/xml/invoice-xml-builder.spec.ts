import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBareInvoiceXml } from "./invoice-xml-builder.js";
import type { ZatcaInvoiceInput, ZatcaParty } from "./invoice-xml.types.js";
import { ZatcaXmlError } from "./invoice-xml.types.js";
import { SDK_SAMPLES, describeIfSdk } from "../testing/fixtures.js";
import { checkInvoiceConsistency } from "../validation/invoice-consistency.js";


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

const baseInvoice: ZatcaInvoiceInput = {
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
  lines: [
    {
      id: "1",
      quantity: "2.000000",
      unitCode: "PCE",
      lineExtensionAmount: "4.00",
      taxAmount: "0.60",
      itemName: "قلم رصاص",
      taxCategoryId: "S",
      taxPercent: "15.00",
      priceAmount: "2.00",
    },
  ],
};

describe("buildBareInvoiceXml — standard invoice", () => {
  const xml = buildBareInvoiceXml(baseInvoice);

  it("never includes the three elements Phase 4 owns", () => {
    expect(xml).not.toContain("UBLExtensions");
    expect(xml).not.toContain("cac:Signature");
    expect(xml).not.toContain("<cbc:ID>QR</cbc:ID>");
  });

  it("carries the ICV and PIH as AdditionalDocumentReference, before the parties", () => {
    const icvIndex = xml.indexOf("<cbc:ID>ICV</cbc:ID>");
    const pihIndex = xml.indexOf("<cbc:ID>PIH</cbc:ID>");
    const supplierIndex = xml.indexOf("AccountingSupplierParty");
    expect(icvIndex).toBeGreaterThan(-1);
    expect(pihIndex).toBeGreaterThan(icvIndex);
    expect(supplierIndex).toBeGreaterThan(pihIndex);
    expect(xml).toContain("<cbc:UUID>23</cbc:UUID>"); // the ICV's own value, inside the ICV reference
    expect(xml).toContain("<cbc:EmbeddedDocumentBinaryObject mimeCode=\"text/plain\">NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==</cbc:EmbeddedDocumentBinaryObject>");
  });

  it("uses invoice type code 388 with the standard subtype flag", () => {
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>');
  });

  it("renders the supplier with its CRN, address, VAT, and legal name, in order", () => {
    const supplierBlock = xml.slice(xml.indexOf("<cac:AccountingSupplierParty>"), xml.indexOf("</cac:AccountingSupplierParty>"));
    expect(supplierBlock.indexOf("PartyIdentification")).toBeLessThan(supplierBlock.indexOf("PostalAddress"));
    expect(supplierBlock.indexOf("PostalAddress")).toBeLessThan(supplierBlock.indexOf("PartyTaxScheme"));
    expect(supplierBlock.indexOf("PartyTaxScheme")).toBeLessThan(supplierBlock.indexOf("PartyLegalEntity"));
    expect(supplierBlock).toContain('<cbc:ID schemeID="CRN">1010010000</cbc:ID>');
    expect(supplierBlock).toContain("<cbc:CompanyID>399999999900003</cbc:CompanyID>");
    expect(supplierBlock).toContain("<cbc:RegistrationName>Maximum Speed Tech Supply LTD</cbc:RegistrationName>");
  });

  it("computes totals correctly and rounds every amount to 2 decimal places", () => {
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="SAR">4.00</cbc:LineExtensionAmount>');
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="SAR">4.00</cbc:TaxExclusiveAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">4.60</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="SAR">4.60</cbc:PayableAmount>');
  });

  it("emits exactly two document-level TaxTotal blocks: a minimal one, then one with subtotals", () => {
    // A third <cac:TaxTotal> exists too, nested inside the InvoiceLine — count only before it.
    const documentPart = xml.slice(0, xml.indexOf("<cac:InvoiceLine>"));
    const taxTotals = documentPart.split("<cac:TaxTotal>").length - 1;
    expect(taxTotals).toBe(2);
    expect(xml).toContain("<cac:TaxTotal><cbc:TaxAmount currencyID=\"SAR\">0.60</cbc:TaxAmount></cac:TaxTotal>");
    expect(xml).toContain("<cac:TaxSubtotal>");
  });

  it("decorates TaxCategory with UN/ECE scheme attributes in TaxSubtotal and AllowanceCharge, but not on the line's ClassifiedTaxCategory", () => {
    expect(xml).toContain('<cbc:ID schemeID="UN/ECE 5305" schemeAgencyID="6">S</cbc:ID>');
    expect(xml).toContain('<cbc:ID schemeID="UN/ECE 5153" schemeAgencyID="6">VAT</cbc:ID>');
    const lineBlock = xml.slice(xml.indexOf("<cac:InvoiceLine>"));
    expect(lineBlock).toContain("<cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID>");
    expect(lineBlock).not.toContain('<cbc:ID schemeID="UN/ECE 5305"');
  });

  it("includes delivery and payment means in the expected place", () => {
    expect(xml).toContain("<cac:Delivery><cbc:ActualDeliveryDate>2026-11-04</cbc:ActualDeliveryDate></cac:Delivery>");
    expect(xml).toContain("<cac:PaymentMeans><cbc:PaymentMeansCode>10</cbc:PaymentMeansCode></cac:PaymentMeans>");
  });
});

describe("buildBareInvoiceXml — simplified invoice (B2C)", () => {
  it("omits the customer party (empty element) and the delivery date", () => {
    const xml = buildBareInvoiceXml({ ...baseInvoice, subtype: "SIMPLIFIED", customer: undefined, actualDeliveryDate: undefined });
    expect(xml).toContain("<cac:AccountingCustomerParty></cac:AccountingCustomerParty>");
    expect(xml).not.toContain("cac:Delivery");
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>');
  });

  it("does not require a customer, unlike a standard invoice", () => {
    expect(() => buildBareInvoiceXml({ ...baseInvoice, subtype: "SIMPLIFIED", customer: undefined })).not.toThrow();
  });
});

describe("buildBareInvoiceXml — credit and debit notes", () => {
  const withNote = {
    ...baseInvoice,
    billingReference: { invoiceId: "SME00002" },
    instructionNote: "In case of goods or services refund | عند ترجيع السلع أو الخدمات",
  };

  it("builds a standard credit note with type code 381 and a billing reference", () => {
    const xml = buildBareInvoiceXml({ ...withNote, documentType: "CREDIT_NOTE" });
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0100000">381</cbc:InvoiceTypeCode>');
    expect(xml).toContain("<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>SME00002</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>");
    expect(xml).toContain("<cbc:InstructionNote>In case of goods or services refund | عند ترجيع السلع أو الخدمات</cbc:InstructionNote>");
    // BillingReference comes after TaxCurrencyCode and before the ICV reference, per the SDK sample.
    expect(xml.indexOf("TaxCurrencyCode")).toBeLessThan(xml.indexOf("BillingReference"));
    expect(xml.indexOf("BillingReference")).toBeLessThan(xml.indexOf("<cbc:ID>ICV</cbc:ID>"));
  });

  it("builds a standard debit note with type code 383", () => {
    const xml = buildBareInvoiceXml({ ...withNote, documentType: "DEBIT_NOTE" });
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0100000">383</cbc:InvoiceTypeCode>');
  });

  it("refuses a credit/debit note with no billing reference", () => {
    expect(() => buildBareInvoiceXml({ ...baseInvoice, documentType: "CREDIT_NOTE", instructionNote: "x" })).toThrow(ZatcaXmlError);
  });

  it("refuses a credit/debit note with no instruction note", () => {
    expect(() => buildBareInvoiceXml({ ...baseInvoice, documentType: "DEBIT_NOTE", billingReference: { invoiceId: "SME00002" } })).toThrow(ZatcaXmlError);
  });
});

describe("buildBareInvoiceXml — validation", () => {
  it("refuses an invoice with no lines", () => {
    expect(() => buildBareInvoiceXml({ ...baseInvoice, lines: [] })).toThrow(ZatcaXmlError);
  });

  it("refuses a standard invoice with no customer", () => {
    expect(() => buildBareInvoiceXml({ ...baseInvoice, customer: undefined })).toThrow(ZatcaXmlError);
  });

  it("refuses a zero-rated or exempt line with no exemption reason code", () => {
    const line = { ...baseInvoice.lines[0]!, taxCategoryId: "Z" as const };
    expect(() => buildBareInvoiceXml({ ...baseInvoice, lines: [line] })).toThrow(ZatcaXmlError);
  });

  it("accepts a zero-rated line once an exemption reason is given, and carries it only on the subtotal/allowance, not the line", () => {
    const line = { ...baseInvoice.lines[0]!, taxCategoryId: "Z" as const, taxPercent: "0.00", taxAmount: "0.00", exemptionReasonCode: "VATEX-SA-35", exemptionReason: "Medicines" };
    const xml = buildBareInvoiceXml({ ...baseInvoice, lines: [line] });
    expect(xml).toContain("<cbc:TaxExemptionReasonCode>VATEX-SA-35</cbc:TaxExemptionReasonCode>");
    const lineBlock = xml.slice(xml.indexOf("<cac:InvoiceLine>"));
    expect(lineBlock).not.toContain("TaxExemptionReasonCode");
  });
});

describe("buildBareInvoiceXml — multiple tax categories on one invoice", () => {
  it("emits one TaxSubtotal and one AllowanceCharge per distinct category, and sums totals across both", () => {
    const standardLine = baseInvoice.lines[0]!;
    const zeroRatedLine = { ...standardLine, id: "2", taxCategoryId: "Z" as const, taxPercent: "0.00", taxAmount: "0.00", exemptionReasonCode: "VATEX-SA-35", exemptionReason: "Medicines", lineExtensionAmount: "10.00" };
    const xml = buildBareInvoiceXml({ ...baseInvoice, lines: [standardLine, zeroRatedLine] });
    expect(xml.split("<cac:TaxSubtotal>").length - 1).toBe(2);
    expect(xml.split("<cac:AllowanceCharge>").length - 1).toBe(2);
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="SAR">14.00</cbc:LineExtensionAmount>'); // 4.00 + 10.00
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">14.60</cbc:TaxInclusiveAmount>'); // 14.00 + 0.60 tax
  });
});

// docs/zatca/HANDOFF.md Phase 8: "a rounding test with awkward amounts." Every other test in this
// file uses amounts that are already clean at 2 decimal places. These are not: three lines in the
// same tax category whose per-line tax amount (0.125, a real value a 4dp-precision tax calculation
// elsewhere in this app -- docs/01-OPEN-DECISIONS.md D3/E3 -- can genuinely produce) sits exactly
// on a rounding boundary at the 2dp display precision the XML format uses.
describe("buildBareInvoiceXml — awkward (boundary) rounding amounts", () => {
  // REVIEW / FOUND, not fixed: this reproduces a real self-consistency bug, not just a display
  // quirk. Each InvoiceLine's own cbc:TaxAmount is rounded to 2dp independently (amountEl calls
  // Money.round(2) on whatever string the caller gave it, per line). The document's cac:TaxTotal /
  // cac:TaxSubtotal, by contrast, are built by buildTaxTotals summing the group's FULL-PRECISION
  // Money total (every line's un-rounded taxAmount added together) and rounding that sum ONCE.
  // These two roundings of the same underlying numbers can legitimately disagree by 0.01 -- and
  // when they do, checkInvoiceConsistency's BR_CO_14/BR_CO_17_TAX checks (which recompute "sum of
  // the lines' own rendered TaxAmount" and compare it to the document TaxTotal) correctly flag it
  // as a hard ERROR, because the document genuinely is internally inconsistent at that point: a
  // human adding up what each line says would get a different number than the subtotal states.
  // This is a real, currently open gap (not guessed at a fix for, per CLAUDE.md §4 -- the correct
  // ZATCA-compliant per-line rounding rule is unconfirmed, docs/01 section Y's own REVIEW note),
  // tracked in docs/01-OPEN-DECISIONS.md section Z.
  it("three lines whose per-line tax amount (0.125) sits on a rounding boundary: the line display and the subtotal display can legitimately disagree by 0.01, and local validation correctly catches it", () => {
    const boundaryLine = { ...baseInvoice.lines[0]!, lineExtensionAmount: "0.833333", taxAmount: "0.125", taxPercent: "15.00" };
    const xml = buildBareInvoiceXml({ ...baseInvoice, lines: [boundaryLine, { ...boundaryLine, id: "2" }, { ...boundaryLine, id: "3" }] });

    // Every line independently rounds its own 0.125 tax to 0.13 (half-up) -- three of them read 0.13 each.
    const lineTaxCount = xml.split('<cbc:TaxAmount currencyID="SAR">0.13</cbc:TaxAmount>').length - 1;
    expect(lineTaxCount).toBe(3);
    // But the subtotal/total sum the full-precision 0.125 three times (0.375) and round ONCE: 0.38, not 0.39.
    expect(xml).toContain('<cac:TaxTotal><cbc:TaxAmount currencyID="SAR">0.38</cbc:TaxAmount></cac:TaxTotal>');
    expect(xml).not.toContain('<cac:TaxTotal><cbc:TaxAmount currencyID="SAR">0.39</cbc:TaxAmount></cac:TaxTotal>');

    // Proven end to end: this is exactly the kind of self-inconsistency checkInvoiceConsistency
    // exists to catch before a document is ever signed or sent (docs/01 section Y).
    const report = checkInvoiceConsistency(xml);
    expect(report.valid).toBe(false);
    const codes = report.issues.filter((i) => i.severity === "error").map((i) => i.code);
    expect(codes).toContain("BR_CO_14");
    expect(codes).toContain("BR_CO_17_TAX");
  });

  it("the same awkward amount on a SINGLE line (no cross-line summing involved) stays self-consistent", () => {
    const xml = buildBareInvoiceXml({ ...baseInvoice, lines: [{ ...baseInvoice.lines[0]!, lineExtensionAmount: "0.833333", taxAmount: "0.125", taxPercent: "15.00" }] });
    const report = checkInvoiceConsistency(xml);
    expect(report.valid).toBe(true); // one line's own rounding can't disagree with "the sum of itself"
  });
});

// Independent cross-check against the official SDK's own sample files, not just this test
// file's own hand-written expectations. Skipped where the SDK isn't present (it's gitignored —
// see docs/vendor/zatca/README-ish note in packages/compliance/zatca-sa/README.md).
describeIfSdk("cross-checked against the official SDK sample XML (docs/vendor/zatca/sdk)", () => {
  // Removes the three elements Phase 4 owns, so the official (signed) sample's remaining
  // top-level structure is comparable to this builder's bare output.
  function stripPhase4Elements(xml: string): string {
    return xml
      .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, "")
      .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, "")
      .replace(/<cac:AdditionalDocumentReference>\s*<cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, "");
  }

  // Direct children of the root <Invoice> element, in document order — not a full XML parse,
  // just enough depth tracking to tell a top-level element from something nested inside it.
  function topLevelChildTags(xml: string): string[] {
    const withoutDecl = xml.replace(/<\?xml[^?]*\?>/, "");
    const tags: string[] = [];
    let depth = -1; // -1 until we see the root <Invoice ...> open tag, which becomes depth 0
    const re = /<(\/?)([a-zA-Z0-9:]+)[^>]*?(\/)?>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(withoutDecl))) {
      const closing = match[1] === "/";
      const name = match[2]!;
      const selfClosing = match[3] === "/";
      if (depth === -1) {
        depth = 0; // the root itself
        continue;
      }
      if (closing) {
        depth--;
      } else {
        if (depth === 0 && !selfClosing) tags.push(name);
        if (!selfClosing) depth++;
      }
    }
    return tags;
  }

  it("matches the Standard_Invoice.xml sample's top-level element order", () => {
    const sample = readFileSync(join(SDK_SAMPLES, "Standard", "Invoice", "Standard_Invoice.xml"), "utf8");
    const expectedTags = topLevelChildTags(stripPhase4Elements(sample));
    const actualTags = topLevelChildTags(buildBareInvoiceXml(baseInvoice));
    expect(actualTags).toEqual(expectedTags);
  });

  it("matches the Standard_Credit_Note.xml sample's top-level element order", () => {
    const sample = readFileSync(join(SDK_SAMPLES, "Standard", "Credit", "Standard_Credit_Note.xml"), "utf8");
    const expectedTags = topLevelChildTags(stripPhase4Elements(sample));
    const actualTags = topLevelChildTags(
      buildBareInvoiceXml({ ...baseInvoice, documentType: "CREDIT_NOTE", billingReference: { invoiceId: "SME00002" }, instructionNote: "x" }),
    );
    expect(actualTags).toEqual(expectedTags);
  });

  it("matches the Simplified_Invoice.xml sample's top-level element order", () => {
    const sample = readFileSync(join(SDK_SAMPLES, "Simplified", "Invoice", "Simplified_Invoice.xml"), "utf8");
    // Collapse repeated InvoiceLine entries to one: the sample has 2 lines, this fixture has 1 —
    // line COUNT is scenario-specific, not a structural fact this cross-check cares about.
    const collapseInvoiceLines = (tags: string[]): string[] => tags.filter((t, i) => t !== "cac:InvoiceLine" || tags[i - 1] !== "cac:InvoiceLine");
    const expectedTags = collapseInvoiceLines(topLevelChildTags(stripPhase4Elements(sample)));
    // The sample has a document-level <cbc:Note>; the fixture needs one too to match shape.
    const actualTags = collapseInvoiceLines(
      topLevelChildTags(buildBareInvoiceXml({ ...baseInvoice, subtype: "SIMPLIFIED", customer: undefined, actualDeliveryDate: undefined, note: { text: "ABC", languageId: "ar" } })),
    );
    expect(actualTags).toEqual(expectedTags);
  });

  it("matches the Standard_Debit_Note.xml sample's top-level element order", () => {
    const sample = readFileSync(join(SDK_SAMPLES, "Standard", "Debit", "Standard_Debit_Note.xml"), "utf8");
    const expectedTags = topLevelChildTags(stripPhase4Elements(sample));
    const actualTags = topLevelChildTags(
      buildBareInvoiceXml({ ...baseInvoice, documentType: "DEBIT_NOTE", billingReference: { invoiceId: "SME00002" }, instructionNote: "x" }),
    );
    expect(actualTags).toEqual(expectedTags);
  });

  it("matches the Simplified_Credit_Note.xml sample's top-level element order", () => {
    // Unlike Simplified_Invoice.xml, this sample DOES carry a <cac:Delivery> — confirms Delivery
    // is independent of subtype (standard vs simplified), not tied to it as this test first
    // assumed; the builder already treats it that way (purely `actualDeliveryDate` presence).
    const sample = readFileSync(join(SDK_SAMPLES, "Simplified", "Credit", "Simplified_Credit_Note.xml"), "utf8");
    const expectedTags = topLevelChildTags(stripPhase4Elements(sample));
    const actualTags = topLevelChildTags(
      buildBareInvoiceXml({
        ...baseInvoice,
        subtype: "SIMPLIFIED",
        documentType: "CREDIT_NOTE",
        customer: undefined,
        billingReference: { invoiceId: "SME00002" },
        instructionNote: "x",
      }),
    );
    expect(actualTags).toEqual(expectedTags);
  });
});
