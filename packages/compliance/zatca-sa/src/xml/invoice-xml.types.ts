// The input the XML builder needs to produce one ZATCA UBL 2.1 invoice document — standard
// (B2B) or simplified (B2C), as an invoice, credit note, or debit note. Deliberately decoupled
// from SalesInvoice/Company/Party (packages/core): nothing in packages/modules/sales may import
// this package (docs/06-COMPLIANCE-PACK-RULES.md §1), so whatever calls the builder (Phase 5,
// not built yet) is responsible for mapping its own data into this shape.
//
// Verified against the official SDK's golden sample XML files (docs/vendor/zatca/sdk/Data/
// Samples, zatca-einvoicing-sdk-238-R3.4.8) for element content, order, and attribute
// decoration — not from memory or the task spec's description alone.

export type ZatcaDocumentType = "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
export type ZatcaInvoiceSubtype = "STANDARD" | "SIMPLIFIED";

// UNCL1001 code list values ZATCA uses (confirmed against the SDK samples).
export const ZATCA_INVOICE_TYPE_CODE: Record<ZatcaDocumentType, string> = {
  INVOICE: "388",
  CREDIT_NOTE: "381",
  DEBIT_NOTE: "383",
};

// The InvoiceTypeCode "name" attribute's 7-digit transaction-type flags. Only the one digit
// Tier 1 needs (standard vs simplified) is set from a known value; // REVIEW: the other six
// digits (self-billing, third-party, nominal, export, summary, reserved) are not modelled —
// confirm against the Technical Guideline before any of those scenarios is ever needed.
export const ZATCA_INVOICE_TYPE_NAME: Record<ZatcaInvoiceSubtype, string> = {
  STANDARD: "0100000",
  SIMPLIFIED: "0200000",
};

export type ZatcaTaxCategoryId = "S" | "Z" | "E" | "O";

export interface ZatcaAddress {
  readonly streetName: string;
  readonly additionalStreetName?: string | undefined;
  readonly buildingNumber?: string | undefined;
  readonly citySubdivisionName: string; // district
  readonly cityName: string;
  readonly postalZone: string;
  readonly countryCode: string; // ISO 3166-1 alpha-2, "SA"
}

export interface ZatcaParty {
  // The seller always has one (CRN); a buyer may or may not.
  readonly partyIdentification?: { readonly schemeId: string; readonly id: string } | undefined;
  readonly address: ZatcaAddress;
  // Absent for a simplified (B2C) invoice's buyer, who may not be VAT-registered or known.
  readonly vatNumber?: string | undefined;
  readonly registrationName: string;
}

export interface ZatcaInvoiceLineInput {
  readonly id: string; // 1-based line number as a string
  readonly quantity: string; // decimal string
  readonly unitCode: string; // UN/ECE Recommendation 20, e.g. "PCE"
  readonly lineExtensionAmount: string; // net amount, decimal string
  readonly taxAmount: string; // this line's tax, decimal string
  readonly itemName: string;
  readonly taxCategoryId: ZatcaTaxCategoryId;
  readonly taxPercent: string; // decimal string, e.g. "15.00" or "0.00"
  readonly exemptionReasonCode?: string | undefined; // required when category is Z or E
  readonly exemptionReason?: string | undefined;
  readonly priceAmount: string; // unit price, decimal string
}

export interface ZatcaInvoiceInput {
  readonly subtype: ZatcaInvoiceSubtype;
  readonly documentType: ZatcaDocumentType;
  readonly id: string; // our own document number, e.g. "INV-2026-000001"
  readonly uuid: string;
  readonly issueDate: string; // YYYY-MM-DD
  readonly issueTime: string; // HH:mm:ss
  readonly currency: string; // DocumentCurrencyCode and TaxCurrencyCode (Tier 1: always equal)
  readonly icv: string; // decimal string of the chain's invoice counter value
  readonly previousInvoiceHash: string; // base64, from EgsChainService
  // Required for CREDIT_NOTE / DEBIT_NOTE, absent for INVOICE.
  readonly billingReference?: { readonly invoiceId: string } | undefined;
  readonly instructionNote?: string | undefined;
  // A free note on the invoice itself (distinct from instructionNote). Optional at any subtype.
  readonly note?: { readonly text: string; readonly languageId: string } | undefined;
  readonly supplier: ZatcaParty;
  // Required for STANDARD, omitted entirely (empty element) for SIMPLIFIED.
  readonly customer?: ZatcaParty | undefined;
  readonly actualDeliveryDate?: string | undefined;
  readonly paymentMeansCode: string; // UN/EDIFACT 4461, e.g. "10" cash, "42" bank transfer
  readonly lines: readonly ZatcaInvoiceLineInput[];
}

export class ZatcaXmlError extends Error {
  constructor(
    readonly code: "MISSING_BILLING_REFERENCE" | "MISSING_INSTRUCTION_NOTE" | "MISSING_CUSTOMER" | "EMPTY_INVOICE" | "MISSING_EXEMPTION_REASON",
    message: string,
  ) {
    super(message);
    this.name = "ZatcaXmlError";
  }
}
