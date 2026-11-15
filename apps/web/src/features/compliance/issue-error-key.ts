const CODES = new Set([
  "COMPLIANCE_UNIT_NOT_READY",
  "COMPLIANCE_SUPPLY_DATE_REQUIRED",
  "COMPLIANCE_SUPPLY_DATE_INVALID",
  "COMPLIANCE_SELLER_VAT_INVALID",
  "COMPLIANCE_BUYER_VAT_INVALID",
  "COMPLIANCE_SELLER_ADDRESS_INVALID",
  "COMPLIANCE_BUYER_ADDRESS_INVALID",
  "COMPLIANCE_SELLER_CR_INVALID",
  "COMPLIANCE_BUYER_CR_INVALID",
  "COMPLIANCE_SELLER_NAME_REQUIRED",
  "COMPLIANCE_BUYER_NAME_REQUIRED",
]);

/** Localized, actionable pre-issue failures shared by invoices and their notes. */
export function complianceIssueErrorKey(code: string | undefined): string | null {
  return code && CODES.has(code) ? `compliance.issueErrors.${code}` : null;
}
