// Builds the "bare" ZATCA UBL 2.1 invoice XML: everything EXCEPT ext:UBLExtensions,
// cac:Signature, and the QR cac:AdditionalDocumentReference — the three elements
// docs/06-COMPLIANCE-PACK-RULES.md §3 / the Security Features Standard say to strip before
// hashing. Phase 4 (hashing/signing/QR, not built yet) hashes exactly this output, signs it,
// and inserts those three elements to produce the final document — it never has to "remove"
// anything, because this builder never added them.
//
// Element order, attribute decoration (schemeID/schemeAgencyID), and which fields are present
// for which document type/subtype are all taken from the official SDK's own sample XML files
// (docs/vendor/zatca/sdk/Data/Samples, zatca-einvoicing-sdk-238-R3.4.8), not from memory or the
// task spec's description — see invoice-xml-builder.spec.ts for the cross-check against them.
import { Money } from "@erp/shared";
import {
  type ZatcaAddress,
  type ZatcaInvoiceInput,
  type ZatcaInvoiceLineInput,
  type ZatcaParty,
  ZATCA_INVOICE_TYPE_CODE,
  ZATCA_INVOICE_TYPE_NAME,
  ZatcaXmlError,
} from "./invoice-xml.types.js";
import { escapeXml } from "./xml-escape.js";

const NS = `xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"`;

// 2 decimal places everywhere in the XML — confirmed by every amount in every official sample.
// The explicit `2` is deliberate, not the currency's own registered minor unit: Tier 1 has no
// multi-currency ZATCA scenario yet, so this is a known Tier-1-only shortcut — revisit if a
// non-2dp currency (e.g. KWD/BHD, 3dp) ever needs ZATCA e-invoicing.
function amountEl(tag: string, amount: string, currency: string): string {
  return `<cbc:${tag} currencyID="${escapeXml(currency)}">${Money.of(amount, currency).round(2).toDecimalString(2)}</cbc:${tag}>`;
}

function buildAddress(address: ZatcaAddress): string {
  const parts = [
    `<cbc:StreetName>${escapeXml(address.streetName)}</cbc:StreetName>`,
    address.additionalStreetName ? `<cbc:AdditionalStreetName>${escapeXml(address.additionalStreetName)}</cbc:AdditionalStreetName>` : "",
    address.buildingNumber ? `<cbc:BuildingNumber>${escapeXml(address.buildingNumber)}</cbc:BuildingNumber>` : "",
    `<cbc:CitySubdivisionName>${escapeXml(address.citySubdivisionName)}</cbc:CitySubdivisionName>`,
    `<cbc:CityName>${escapeXml(address.cityName)}</cbc:CityName>`,
    `<cbc:PostalZone>${escapeXml(address.postalZone)}</cbc:PostalZone>`,
    `<cac:Country><cbc:IdentificationCode>${escapeXml(address.countryCode)}</cbc:IdentificationCode></cac:Country>`,
  ];
  return `<cac:PostalAddress>${parts.join("")}</cac:PostalAddress>`;
}

function buildParty(party: ZatcaParty): string {
  const identification = party.partyIdentification
    ? `<cac:PartyIdentification><cbc:ID schemeID="${escapeXml(party.partyIdentification.schemeId)}">${escapeXml(party.partyIdentification.id)}</cbc:ID></cac:PartyIdentification>`
    : "";
  const taxScheme = party.vatNumber
    ? `<cac:PartyTaxScheme><cbc:CompanyID>${escapeXml(party.vatNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`
    : "";
  return (
    `<cac:Party>${identification}${buildAddress(party.address)}${taxScheme}` +
    `<cac:PartyLegalEntity><cbc:RegistrationName>${escapeXml(party.registrationName)}</cbc:RegistrationName></cac:PartyLegalEntity>` +
    `</cac:Party>`
  );
}

interface TaxGroup {
  readonly taxCategoryId: string;
  readonly taxPercent: string;
  readonly exemptionReasonCode: string | undefined;
  readonly exemptionReason: string | undefined;
  readonly taxableAmount: Money;
  readonly taxAmount: Money;
}

function groupLinesByTaxCategory(lines: readonly ZatcaInvoiceLineInput[], currency: string): TaxGroup[] {
  const groups = new Map<string, TaxGroup>();
  for (const line of lines) {
    const key = `${line.taxCategoryId}|${line.taxPercent}|${line.exemptionReasonCode ?? ""}`;
    const existing = groups.get(key);
    const lineTaxable = Money.of(line.lineExtensionAmount, currency);
    const lineTax = Money.of(line.taxAmount, currency);
    if (existing) {
      groups.set(key, { ...existing, taxableAmount: existing.taxableAmount.add(lineTaxable), taxAmount: existing.taxAmount.add(lineTax) });
    } else {
      groups.set(key, {
        taxCategoryId: line.taxCategoryId,
        taxPercent: line.taxPercent,
        exemptionReasonCode: line.exemptionReasonCode,
        exemptionReason: line.exemptionReason,
        taxableAmount: lineTaxable,
        taxAmount: lineTax,
      });
    }
  }
  return [...groups.values()];
}

// `wrapperTag`: AllowanceCharge and TaxSubtotal both nest a "cac:TaxCategory" carrying
// schemeID/schemeAgencyID attributes on ID and on TaxScheme/ID; InvoiceLine/Item nests the same
// shape but as "cac:ClassifiedTaxCategory" and WITHOUT those attributes. Confirmed from the
// official samples — not a stylistic choice, and easy to get wrong (this builder did, once).
function buildTaxCategory(
  group: Pick<TaxGroup, "taxCategoryId" | "taxPercent" | "exemptionReasonCode" | "exemptionReason">,
  wrapperTag: "TaxCategory" | "ClassifiedTaxCategory",
): string {
  const withSchemeAttrs = wrapperTag === "TaxCategory";
  const idAttrs = withSchemeAttrs ? ` schemeID="UN/ECE 5305" schemeAgencyID="6"` : "";
  const taxSchemeIdAttrs = withSchemeAttrs ? ` schemeID="UN/ECE 5153" schemeAgencyID="6"` : "";
  const exemption =
    group.exemptionReasonCode && group.exemptionReason
      ? `<cbc:TaxExemptionReasonCode>${escapeXml(group.exemptionReasonCode)}</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>${escapeXml(group.exemptionReason)}</cbc:TaxExemptionReason>`
      : "";
  return (
    `<cac:${wrapperTag}><cbc:ID${idAttrs}>${escapeXml(group.taxCategoryId)}</cbc:ID><cbc:Percent>${group.taxPercent}</cbc:Percent>${exemption}` +
    `<cac:TaxScheme><cbc:ID${taxSchemeIdAttrs}>VAT</cbc:ID></cac:TaxScheme></cac:${wrapperTag}>`
  );
}

// One zero-amount AllowanceCharge per distinct tax category present on the invoice — present in
// every official sample regardless of whether a real discount exists. Tier 1 has no document- or
// line-level discount/charge model yet (docs/01-OPEN-DECISIONS.md section E6), so this is always
// the zero placeholder the schema evidently expects, never a real discount.
function buildAllowanceCharges(groups: readonly TaxGroup[], currency: string): string {
  return groups
    .map(
      (g) =>
        `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>` +
        `${amountEl("Amount", "0", currency)}${buildTaxCategory(g, "TaxCategory")}</cac:AllowanceCharge>`,
    )
    .join("");
}

function buildTaxTotals(groups: readonly TaxGroup[], currency: string): string {
  const total = groups.reduce((sum, g) => sum.add(g.taxAmount), Money.zero(currency));
  const minimal = `<cac:TaxTotal>${amountEl("TaxAmount", total.toDecimalString(2), currency)}</cac:TaxTotal>`;
  const subtotals = groups
    .map(
      (g) =>
        `<cac:TaxSubtotal>${amountEl("TaxableAmount", g.taxableAmount.toDecimalString(2), currency)}${amountEl("TaxAmount", g.taxAmount.toDecimalString(2), currency)}${buildTaxCategory(g, "TaxCategory")}</cac:TaxSubtotal>`,
    )
    .join("");
  const full = `<cac:TaxTotal>${amountEl("TaxAmount", total.toDecimalString(2), currency)}${subtotals}</cac:TaxTotal>`;
  return minimal + full;
}

// BR-CO-15 (EN 16931 / ZATCA Schematron, "error" severity, no tolerance -- confirmed in
// docs/vendor/zatca/sdk/Data/Rules/Schematrons/CEN-EN16931-UBL.xsl): TaxInclusiveAmount must equal
// TaxExclusiveAmount + the document's VAT amount EXACTLY as rendered. Rounding `lineExtension` and
// `totalTax` to 2dp independently and only THEN adding them (rather than adding the full-precision
// Money values and rounding the sum once) is deliberate: it guarantees TaxInclusiveAmount is always
// exactly TaxExclusiveAmount-as-rendered plus TaxAmount-as-rendered, by construction, with no
// boundary case where two independent roundings of the same underlying numbers can disagree by
// 0.01 (the same class of bug as the per-line/subtotal tax rounding documented in
// docs/01-OPEN-DECISIONS.md section Z).
function buildLegalMonetaryTotal(lineExtension: Money, totalTax: Money, currency: string): string {
  const roundedLineExtension = lineExtension.round(2);
  const roundedTax = totalTax.round(2);
  const taxInclusive = roundedLineExtension.add(roundedTax);
  return (
    `<cac:LegalMonetaryTotal>` +
    amountEl("LineExtensionAmount", roundedLineExtension.toDecimalString(2), currency) +
    amountEl("TaxExclusiveAmount", roundedLineExtension.toDecimalString(2), currency) +
    amountEl("TaxInclusiveAmount", taxInclusive.toDecimalString(2), currency) +
    amountEl("AllowanceTotalAmount", "0", currency) +
    amountEl("PrepaidAmount", "0", currency) +
    amountEl("PayableAmount", taxInclusive.toDecimalString(2), currency) +
    `</cac:LegalMonetaryTotal>`
  );
}

function buildInvoiceLine(line: ZatcaInvoiceLineInput, currency: string): string {
  const lineTotalWithTax = Money.of(line.lineExtensionAmount, currency).add(Money.of(line.taxAmount, currency));
  return (
    `<cac:InvoiceLine><cbc:ID>${escapeXml(line.id)}</cbc:ID>` +
    `<cbc:InvoicedQuantity unitCode="${escapeXml(line.unitCode)}">${line.quantity}</cbc:InvoicedQuantity>` +
    amountEl("LineExtensionAmount", line.lineExtensionAmount, currency) +
    `<cac:TaxTotal>${amountEl("TaxAmount", line.taxAmount, currency)}${amountEl("RoundingAmount", lineTotalWithTax.toDecimalString(2), currency)}</cac:TaxTotal>` +
    `<cac:Item><cbc:Name>${escapeXml(line.itemName)}</cbc:Name>${buildTaxCategory(
      { taxCategoryId: line.taxCategoryId, taxPercent: line.taxPercent, exemptionReasonCode: undefined, exemptionReason: undefined },
      "ClassifiedTaxCategory",
    )}</cac:Item>` +
    `<cac:Price>${amountEl("PriceAmount", line.priceAmount, currency)}</cac:Price>` +
    `</cac:InvoiceLine>`
  );
}

function validate(input: ZatcaInvoiceInput): void {
  if (input.lines.length === 0) {
    throw new ZatcaXmlError("EMPTY_INVOICE", "An invoice needs at least one line");
  }
  if (input.documentType !== "INVOICE") {
    if (!input.billingReference) {
      throw new ZatcaXmlError("MISSING_BILLING_REFERENCE", `A ${input.documentType} must reference the invoice it is raised against`);
    }
    if (!input.instructionNote) {
      throw new ZatcaXmlError("MISSING_INSTRUCTION_NOTE", `A ${input.documentType} must carry a reason (InstructionNote)`);
    }
  }
  if (input.subtype === "STANDARD" && !input.customer) {
    throw new ZatcaXmlError("MISSING_CUSTOMER", "A standard (B2B) invoice must name the buyer");
  }
  for (const line of input.lines) {
    if ((line.taxCategoryId === "Z" || line.taxCategoryId === "E") && !line.exemptionReasonCode) {
      throw new ZatcaXmlError("MISSING_EXEMPTION_REASON", `Line ${line.id}: a zero-rated or exempt line needs a tax exemption reason code`);
    }
  }
}

export function buildBareInvoiceXml(input: ZatcaInvoiceInput): string {
  validate(input);
  const currency = input.currency;
  const groups = groupLinesByTaxCategory(input.lines, currency);
  const totalTax = groups.reduce((sum, g) => sum.add(g.taxAmount), Money.zero(currency));
  const lineExtension = input.lines.reduce((sum, l) => sum.add(Money.of(l.lineExtensionAmount, currency)), Money.zero(currency));

  const header =
    `<cbc:ProfileID>reporting:1.0</cbc:ProfileID>` +
    `<cbc:ID>${escapeXml(input.id)}</cbc:ID>` +
    `<cbc:UUID>${escapeXml(input.uuid)}</cbc:UUID>` +
    `<cbc:IssueDate>${input.issueDate}</cbc:IssueDate>` +
    `<cbc:IssueTime>${input.issueTime}</cbc:IssueTime>` +
    `<cbc:InvoiceTypeCode name="${ZATCA_INVOICE_TYPE_NAME[input.subtype]}">${ZATCA_INVOICE_TYPE_CODE[input.documentType]}</cbc:InvoiceTypeCode>` +
    (input.note ? `<cbc:Note languageID="${escapeXml(input.note.languageId)}">${escapeXml(input.note.text)}</cbc:Note>` : "") +
    `<cbc:DocumentCurrencyCode>${escapeXml(currency)}</cbc:DocumentCurrencyCode>` +
    `<cbc:TaxCurrencyCode>${escapeXml(currency)}</cbc:TaxCurrencyCode>` +
    (input.billingReference ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${escapeXml(input.billingReference.invoiceId)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>` : "") +
    `<cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${escapeXml(input.icv)}</cbc:UUID></cac:AdditionalDocumentReference>` +
    `<cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${escapeXml(input.previousInvoiceHash)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>`;

  const parties =
    `<cac:AccountingSupplierParty>${buildParty(input.supplier)}</cac:AccountingSupplierParty>` +
    `<cac:AccountingCustomerParty>${input.customer ? buildParty(input.customer) : ""}</cac:AccountingCustomerParty>`;

  const delivery = input.actualDeliveryDate ? `<cac:Delivery><cbc:ActualDeliveryDate>${input.actualDeliveryDate}</cbc:ActualDeliveryDate></cac:Delivery>` : "";

  const paymentMeans = `<cac:PaymentMeans><cbc:PaymentMeansCode>${escapeXml(input.paymentMeansCode)}</cbc:PaymentMeansCode>${input.instructionNote ? `<cbc:InstructionNote>${escapeXml(input.instructionNote)}</cbc:InstructionNote>` : ""}</cac:PaymentMeans>`;

  const body =
    buildAllowanceCharges(groups, currency) +
    buildTaxTotals(groups, currency) +
    buildLegalMonetaryTotal(lineExtension, totalTax, currency) +
    input.lines.map((l) => buildInvoiceLine(l, currency)).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<Invoice ${NS}>${header}${parties}${delivery}${paymentMeans}${body}</Invoice>`;
}
