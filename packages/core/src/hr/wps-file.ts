// The WPS wages file: read field-by-field from the official specification --
//   Ministry of Human Resources and Social Development, "WPS Wages File Technical Specification"
//   (hrsd.gov.sa/sites/default/files/2017-06/WPS%20Wages%20File%20Technical%20Specification.pdf),
//   read in full 18 Oct 2026.
//
// File shape (section 1.7-1.8 of the spec): a text file, values separated by TAB, one language
// per field, SAR only. A Header Group line once at the top, then one Content/Repeating Group line
// per employee. Confirmed by a bank's own customer FAQ (SAB, "FAQ's - Mudad Service"): the
// establishment sends this file to its bank, the bank processes and digitally signs it, and the
// establishment uploads that *same* signed file to the Mudad platform -- there is no second,
// Mudad-specific format to build.
//
// REVIEW: the spec's field table gives each field a bracketed tag (e.g. [MOL-BAS]) as a
// *label for the specification itself* ("This is the label which must appear at the start of the
// Field" -- section 1.2, "Field Tag"), not necessarily as literal text embedded in each data
// value. Every vendor guide found alongside the spec describes a flat tab-separated row, not
// tag-prefixed cells, which is what this module generates. Validate the first real file against a
// bank's own test tool before relying on it -- this is the one remaining point the spec itself
// left genuinely ambiguous.

import { Money } from "@erp/shared";

export interface WpsCompanySettings {
  readonly bankSarieId: string; // [DEST-ID] -- SARIE id of the establishment's bank
  readonly bankAccountNumber: string; // [BANK-ACC]
  readonly molEstablishmentId: string; // [MOL-ESTBID]
}

export interface WpsEmployeeRow {
  readonly iban: string; // [59-ACC]
  readonly name: string; // [59-NAME]
  readonly nationalId: string; // [MOL-ID]
  readonly basicSalary: string; // [MOL-BAS]
  readonly housingAllowance: string; // [MOL-HAL]
  readonly otherEarnings: string; // [MOL-OEA]
  readonly deductions: string; // [MOL-DED]
}

export interface BuildWpsFileParams {
  readonly company: WpsCompanySettings;
  readonly valueDate: Date; // [32A-VAL] -- the date funds are to be paid
  readonly fileReference: string; // [FILE-REF] -- must be unique per establishment, never reused
  readonly employees: readonly WpsEmployeeRow[];
}

const TAB = "\t";

function yyyymmdd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// Format conventions, spec section 5.4: digit fields use a comma as the decimal point, not a dot.
function wpsDecimal(value: string): string {
  return value.replace(".", ",");
}

export class WpsFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WpsFileError";
  }
}

// Reject demo markers and file delimiters. This is not bank acceptance or account verification.
export function isWpsSettingsUsable(settings: WpsCompanySettings): boolean {
  return [settings.bankSarieId, settings.bankAccountNumber, settings.molEstablishmentId].every((value) => value.trim().length > 0 && !/[\t\r\n]|demo|placeholder|test|تجريب/i.test(value));
}

export function buildWpsWagesFile(params: BuildWpsFileParams): string {
  if (params.employees.length === 0) throw new WpsFileError("No employees to include in the wages file");
  if (!isWpsSettingsUsable(params.company)) throw new WpsFileError("Replace demo WPS settings with the bank's real establishment details before exporting");
  if ([params.fileReference, ...params.employees.flatMap((e) => [e.name, e.iban, e.nationalId])].some((v) => /[\t\r\n]/.test(v))) throw new WpsFileError("WPS fields cannot contain tabs or newlines");

  const amount = (value: string): Money => Money.of(value, "SAR").round(2);
  const netOf = (e: WpsEmployeeRow): Money => amount(e.basicSalary).add(amount(e.housingAllowance)).add(amount(e.otherEarnings)).subtract(amount(e.deductions));
  const totalAmount = params.employees.reduce((sum, e) => sum.add(netOf(e)), Money.zero("SAR"));

  const headerLine = [
    params.company.bankSarieId,
    params.company.bankAccountNumber,
    "SAR",
    yyyymmdd(params.valueDate),
    wpsDecimal(totalAmount.toDecimalString(2)),
    params.fileReference,
    params.company.molEstablishmentId,
  ].join(TAB);

  const contentLines = params.employees.map((e) => {
    const net = netOf(e);
    return [
      wpsDecimal(net.toDecimalString(2)),
      e.iban.toUpperCase(),
      e.name,
      // Spec format conventions (section 5.4): every MOL-* amount is two decimal places, same as
      // the header total -- the API's own figures carry four (NUMERIC(19,4)), so round here.
      wpsDecimal(amount(e.basicSalary).toDecimalString(2)),
      wpsDecimal(amount(e.housingAllowance).toDecimalString(2)),
      wpsDecimal(amount(e.otherEarnings).toDecimalString(2)),
      wpsDecimal(amount(e.deductions).toDecimalString(2)),
      e.nationalId,
    ].join(TAB);
  });

  // Spec section 1.7(2): "-" at the start of a line marks end-of-file data.
  return [headerLine, ...contentLines, "-"].join("\r\n");
}
