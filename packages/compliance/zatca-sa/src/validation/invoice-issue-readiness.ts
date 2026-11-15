import type { ZatcaDocumentType, ZatcaParty } from "../xml/invoice-xml.types.js";

export type InvoiceIssueProblem =
  | "COMPLIANCE_SUPPLY_DATE_REQUIRED"
  | "COMPLIANCE_SUPPLY_DATE_INVALID"
  | "COMPLIANCE_SELLER_VAT_INVALID"
  | "COMPLIANCE_BUYER_VAT_INVALID"
  | "COMPLIANCE_SELLER_ADDRESS_INVALID"
  | "COMPLIANCE_BUYER_ADDRESS_INVALID"
  | "COMPLIANCE_SELLER_CR_INVALID"
  | "COMPLIANCE_BUYER_CR_INVALID"
  | "COMPLIANCE_SELLER_NAME_REQUIRED"
  | "COMPLIANCE_BUYER_NAME_REQUIRED";

/** Known identity/address/supply-date rules from official SDK 3.4.8 (2026-11-15).
 * Runs before posting; it does not assert acceptance or replace authority validation.
 */
export function invoiceIssueProblems(input: {
  readonly documentType: ZatcaDocumentType;
  readonly supplier: ZatcaParty;
  readonly customer?: ZatcaParty | undefined;
  readonly actualDeliveryDate?: string | undefined;
}): InvoiceIssueProblem[] {
  const errors: InvoiceIssueProblem[] = [];
  const vat = /^3\d{13}3$/;
  for (const [role, party] of [
    ["SELLER", input.supplier],
    ["BUYER", input.customer],
  ] as const) {
    if (!party) continue;
    if (!party.registrationName.trim()) errors.push(`COMPLIANCE_${role}_NAME_REQUIRED`);
    if ((role === "SELLER" || party.vatNumber) && !vat.test(party.vatNumber ?? ""))
      errors.push(`COMPLIANCE_${role}_VAT_INVALID`);
    if (
      party.partyIdentification?.schemeId === "CRN" &&
      !/^\d{10}$/.test(party.partyIdentification.id)
    )
      errors.push(`COMPLIANCE_${role}_CR_INVALID`);
    const a = party.address;
    const common = Boolean(
      a.streetName.trim() && a.cityName.trim() && /^[A-Z]{2}$/.test(a.countryCode),
    );
    const national = Boolean(
      a.buildingNumber?.trim() && a.citySubdivisionName.trim() && /^\d{5}$/.test(a.postalZone),
    );
    if (
      !common ||
      ((role === "SELLER" || a.countryCode === "SA") && !national) ||
      (role === "SELLER" && !/^\d{4}$/.test(a.buildingNumber ?? ""))
    )
      errors.push(`COMPLIANCE_${role}_ADDRESS_INVALID`);
  }
  const date = input.actualDeliveryDate;
  if (input.customer && input.documentType === "INVOICE" && !date)
    errors.push("COMPLIANCE_SUPPLY_DATE_REQUIRED");
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date)
  )
    errors.push("COMPLIANCE_SUPPLY_DATE_INVALID");
  return errors;
}
