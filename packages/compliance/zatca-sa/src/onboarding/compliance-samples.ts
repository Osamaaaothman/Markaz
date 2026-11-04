// The six sample documents ZATCA's compliance-check endpoint expects before it will issue a
// production CSID: a standard (B2B) and a simplified (B2C) invoice, credit note and debit note.
//
// Built from the seller's own profile so the seller block, VAT number and address are the real
// ones being onboarded. The BUYER on the standard samples, the item and the amounts are test data
// that exists only inside these requests to ZATCA's compliance endpoint -- none of it is stored as
// an invoice or reaches any ledger.
// REVIEW: the exact sample content ZATCA's compliance check wants (item, amounts, the references
// credit/debit notes carry) was not confirmed against the Integration Sandbox, which this session
// could not reach; the shape follows the SDK's own sample documents.
import { FIRST_INVOICE_PREVIOUS_HASH } from "../egs-chain.service.js";
import type { ZatcaDocumentType, ZatcaInvoiceInput, ZatcaInvoiceSubtype, ZatcaParty } from "../xml/invoice-xml.types.js";
import type { QrFields } from "../xml/qr.js";

export interface ComplianceSample {
  // Stable label for the UI and tests, e.g. "STANDARD_CREDIT_NOTE".
  readonly label: string;
  readonly isSimplified: boolean;
  readonly signingTime: string;
  readonly qr: Pick<QrFields, "sellerName" | "vatNumber" | "timestamp" | "invoiceTotalWithVat" | "vatTotal">;
  readonly input: ZatcaInvoiceInput;
}

// Saudi Arabia is UTC+3 all year (no daylight saving), so a fixed offset is exact.
export function riyadhDateTime(now: Date): { readonly date: string; readonly time: string } {
  const shifted = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 19) };
}

const SAMPLE_BUYER: ZatcaParty = {
  address: { streetName: "Salah Al-Din", buildingNumber: "1111", citySubdivisionName: "Al-Murooj", cityName: "Riyadh", postalZone: "12222", countryCode: "SA" },
  vatNumber: "399999999800003",
  registrationName: "Compliance Check Buyer",
};

const KINDS: readonly (readonly [ZatcaInvoiceSubtype, ZatcaDocumentType])[] = [
  ["STANDARD", "INVOICE"],
  ["STANDARD", "CREDIT_NOTE"],
  ["STANDARD", "DEBIT_NOTE"],
  ["SIMPLIFIED", "INVOICE"],
  ["SIMPLIFIED", "CREDIT_NOTE"],
  ["SIMPLIFIED", "DEBIT_NOTE"],
];

export function buildComplianceSamples(seller: ZatcaParty, now: Date, newUuid: () => string): readonly ComplianceSample[] {
  const { date, time } = riyadhDateTime(now);
  const timestamp = `${date}T${time}`;
  return KINDS.map(([subtype, documentType], index): ComplianceSample => {
    const input: ZatcaInvoiceInput = {
      subtype,
      documentType,
      id: `CHECK-${subtype === "STANDARD" ? "STD" : "SMP"}-${documentType}-${index + 1}`,
      uuid: newUuid(),
      issueDate: date,
      issueTime: time,
      currency: "SAR",
      icv: String(index + 1),
      // REVIEW: every sample reuses the first-invoice PIH; whether the compliance endpoint checks the chain is unconfirmed.
      previousInvoiceHash: FIRST_INVOICE_PREVIOUS_HASH,
      supplier: seller,
      customer: subtype === "STANDARD" ? SAMPLE_BUYER : undefined,
      ...(subtype === "STANDARD" ? { actualDeliveryDate: date } : {}),
      paymentMeansCode: "10",
      ...(documentType !== "INVOICE" ? { billingReference: { invoiceId: "CHECK-ORIGINAL-1" }, instructionNote: "Compliance check" } : {}),
      lines: [{ id: "1", quantity: "1.000000", unitCode: "PCE", lineExtensionAmount: "100.00", taxAmount: "15.00", itemName: "Compliance check item", taxCategoryId: "S", taxPercent: "15.00", priceAmount: "100.00" }],
    };
    return {
      label: `${subtype}_${documentType}`,
      isSimplified: subtype === "SIMPLIFIED",
      signingTime: timestamp,
      qr: { sellerName: seller.registrationName, vatNumber: seller.vatNumber ?? "", timestamp, invoiceTotalWithVat: "115.00", vatTotal: "15.00" },
      input,
    };
  });
}
