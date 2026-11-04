// Local, offline consistency checks on a ZATCA invoice document (bare or signed): the document's
// own totals must add up, its tax breakdown must match its lines, and the header facts the
// pipeline controls (type code, UUID, ICV, PIH, issue date/time, seller VAT format) must be
// well-formed.
//
// WHAT THIS IS NOT: it is not ZATCA's validation. ZATCA validates against its own XSD and
// Schematron rule set (shipped in the official SDK under Data/Rules, and applied again by the
// Fatoora API); none of those files are in this repository, and this module does not re-implement
// them. It catches OUR bugs early and cheaply (an arithmetic slip in a mapper, a missing ICV) so
// a document is never signed and queued in a state we could have rejected ourselves. A report
// from this module saying `valid` is never evidence that ZATCA will accept the document
// (docs/06-COMPLIANCE-PACK-RULES.md §7: never mark an invoice legally valid on local validation).
//
// The arithmetic rules are the EN 16931 business rules BR-CO-10, -13, -14, -15, -16 and -17 that
// ZATCA's schema is built on, evaluated in exact integer hundredths (never floats).
// REVIEW: the per-line "tax ~ net x rate" and "net ~ quantity x price" checks are reported as
// WARNINGS with a 0.01 tolerance, because the exact rounding rule ZATCA applies per line was not
// confirmed against the Schematron (not available in this session).
import { IssueCollector, type ValidationReport } from "./validation-report.js";
import { children, descendants, firstDescendant, formatHundredths, parseXml, textOf, toHundredths } from "./xml-reader.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_TYPE_CODES = new Set(["388", "381", "383"]);

function childText(scope: Element, ns: "cbc" | "cac", name: string): string | undefined {
  return textOf(children(scope, ns, name)[0]);
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

function amountOf(scope: Element, name: string, c: IssueCollector, where: string): bigint | undefined {
  const raw = childText(scope, "cbc", name);
  const parsed = toHundredths(raw);
  if (parsed === undefined) c.error("AMOUNT_MISSING_OR_MALFORMED", `${where}: ${name} is ${raw === undefined ? "missing" : `"${raw}", not a decimal with at most 2 places`}`);
  return parsed;
}

// Decimal string -> integer scaled by 10^scale; undefined if malformed or more precise than scale.
function scaled(value: string | undefined, scale: number): bigint | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[2] ?? "").length > scale) return undefined;
  return BigInt(match[1]! + (match[2] ?? "").padEnd(scale, "0"));
}

export function checkInvoiceConsistency(xml: string): ValidationReport {
  const c = new IssueCollector();
  let root: Element;
  let doc: Document;
  try {
    doc = parseXml(xml);
    root = doc.documentElement;
  } catch (e) {
    c.error("NOT_WELL_FORMED", (e as Error).message);
    return c.report();
  }

  checkHeader(root, doc, c);
  checkSeller(root, c);
  checkTotals(root, c);
  checkCurrencyAttributes(doc, root, c);
  return c.report();
}

function checkHeader(root: Element, doc: Document, c: IssueCollector): void {
  const uuid = childText(root, "cbc", "UUID");
  if (!uuid || !UUID_RE.test(uuid)) c.error("UUID_INVALID", `cbc:UUID must be a UUID, got "${uuid ?? ""}"`);

  const issueDate = childText(root, "cbc", "IssueDate");
  if (!issueDate || !isRealDate(issueDate)) c.error("ISSUE_DATE_INVALID", `cbc:IssueDate must be a real YYYY-MM-DD date, got "${issueDate ?? ""}"`);
  const issueTime = childText(root, "cbc", "IssueTime");
  if (!issueTime || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(issueTime)) c.error("ISSUE_TIME_INVALID", `cbc:IssueTime must be HH:mm:ss, got "${issueTime ?? ""}"`);

  if (!childText(root, "cbc", "ID")) c.error("ID_MISSING", "cbc:ID (the document number) is missing");

  const typeEl = children(root, "cbc", "InvoiceTypeCode")[0];
  const typeCode = textOf(typeEl);
  const typeName = typeEl?.getAttribute("name") ?? "";
  if (!typeCode || !VALID_TYPE_CODES.has(typeCode)) c.error("TYPE_CODE_INVALID", `InvoiceTypeCode must be 388, 381 or 383, got "${typeCode ?? ""}"`);
  if (!/^0[12]\d{5}$/.test(typeName)) c.error("TYPE_NAME_INVALID", `InvoiceTypeCode@name must be 7 digits starting 01 (standard) or 02 (simplified), got "${typeName}"`);

  const refs = children(root, "cac", "AdditionalDocumentReference");
  const refById = (id: string): Element | undefined => refs.find((r) => childText(r, "cbc", "ID") === id);

  const icvEl = refById("ICV");
  const icv = icvEl ? textOf(children(icvEl, "cbc", "UUID")[0]) : undefined;
  if (!icv || !/^[1-9]\d*$/.test(icv)) c.error("ICV_INVALID", `The ICV reference must be a positive integer, got "${icv ?? ""}"`);

  const pihEl = refById("PIH");
  const pih = pihEl ? textOf(firstDescendant(pihEl, "cbc", "EmbeddedDocumentBinaryObject")) : undefined;
  if (!pih) c.error("PIH_MISSING", "The PIH (previous invoice hash) reference is missing");
  else if (!/^[0-9a-f]{64}$/.test(Buffer.from(pih, "base64").toString("utf8"))) c.error("PIH_INVALID", "The PIH must be base64 of a 64-character lowercase hex SHA-256 string");

  if (typeCode === "381" || typeCode === "383") {
    if (!children(root, "cac", "BillingReference").length) c.error("BILLING_REFERENCE_MISSING", "A credit or debit note must carry a cac:BillingReference");
    const note = descendants(doc, "cbc", "InstructionNote")[0];
    if (!textOf(note)) c.error("INSTRUCTION_NOTE_MISSING", "A credit or debit note must carry a reason in cbc:InstructionNote");
  }

  if (typeName.startsWith("01")) {
    const customer = children(root, "cac", "AccountingCustomerParty")[0];
    const name = customer ? textOf(firstDescendant(customer, "cbc", "RegistrationName")) : undefined;
    if (!name) c.error("BUYER_MISSING", "A standard (B2B) invoice must name the buyer");
  }
}

function checkSeller(root: Element, c: IssueCollector): void {
  const seller = children(root, "cac", "AccountingSupplierParty")[0];
  if (!seller) {
    c.error("SELLER_MISSING", "cac:AccountingSupplierParty is missing");
    return;
  }
  if (!textOf(firstDescendant(seller, "cbc", "RegistrationName"))) c.error("SELLER_NAME_MISSING", "The seller's registration name is missing");
  const vat = textOf(firstDescendant(seller, "cbc", "CompanyID"));
  if (!vat || !/^\d{15}$/.test(vat)) c.error("SELLER_VAT_INVALID", `The seller's VAT number must be 15 digits, got "${vat ?? ""}"`);
  // REVIEW: "starts and ends with 3" is the rule as remembered from ZATCA's business rules; not re-confirmed this session.
  else if (!/^3\d{13}3$/.test(vat)) c.warn("SELLER_VAT_SHAPE", `The seller's VAT number "${vat}" does not start and end with 3`);
}

interface LineFacts {
  readonly id: string;
  readonly net: bigint;
  readonly tax: bigint;
  readonly key: string; // category|percent
}

function checkTotals(root: Element, c: IssueCollector): void {
  const lineEls = children(root, "cac", "InvoiceLine");
  if (lineEls.length === 0) {
    c.error("NO_LINES", "The document has no invoice lines");
    return;
  }

  const lines: LineFacts[] = [];
  for (const line of lineEls) {
    const id = childText(line, "cbc", "ID") ?? "?";
    const where = `Line ${id}`;
    const net = amountOf(line, "LineExtensionAmount", c, where);
    const lineTaxTotal = children(line, "cac", "TaxTotal")[0];
    const tax = lineTaxTotal ? amountOf(lineTaxTotal, "TaxAmount", c, where) : undefined;
    if (!lineTaxTotal) c.error("LINE_TAX_MISSING", `${where}: cac:TaxTotal is missing`);
    const rounding = lineTaxTotal ? amountOf(lineTaxTotal, "RoundingAmount", c, where) : undefined;
    const item = children(line, "cac", "Item")[0];
    const category = item ? children(item, "cac", "ClassifiedTaxCategory")[0] : undefined;
    const catId = category ? childText(category, "cbc", "ID") : undefined;
    const percentText = category ? childText(category, "cbc", "Percent") : undefined;
    const percent = toHundredths(percentText);
    if (!catId || percent === undefined) {
      c.error("LINE_CATEGORY_MISSING", `${where}: the item's tax category and percent are missing or malformed`);
      continue;
    }
    if (net === undefined || tax === undefined) continue;
    if (rounding !== undefined && rounding !== net + tax) c.error("LINE_ROUNDING_MISMATCH", `${where}: RoundingAmount ${formatHundredths(rounding)} is not net ${formatHundredths(net)} + tax ${formatHundredths(tax)}`);

    // Warnings only -- see the REVIEW note in this file's header.
    const qty = scaled(textOf(children(line, "cbc", "InvoicedQuantity")[0]), 6);
    const priceEl = children(line, "cac", "Price")[0];
    const price = scaled(priceEl ? childText(priceEl, "cbc", "PriceAmount") : undefined, 2);
    if (qty !== undefined && price !== undefined) {
      const diff = qty * price - net * 1_000_000n; // both in units of 1e-8
      if ((diff < 0n ? -diff : diff) > 1_000_000n) c.warn("LINE_NET_NOT_QTY_TIMES_PRICE", `${where}: net ${formatHundredths(net)} differs from quantity x price by more than 0.01`);
    }
    const taxDiff = tax * 10_000n - net * percent; // both in units of 1e-6
    if ((taxDiff < 0n ? -taxDiff : taxDiff) > 10_000n) c.warn("LINE_TAX_NOT_RATE_TIMES_NET", `${where}: tax ${formatHundredths(tax)} differs from ${percentText}% of ${formatHundredths(net)} by more than 0.01`);

    lines.push({ id, net, tax, key: `${catId}|${percent.toString()}` });
  }

  const monetary = children(root, "cac", "LegalMonetaryTotal")[0];
  if (!monetary) {
    c.error("MONETARY_TOTAL_MISSING", "cac:LegalMonetaryTotal is missing");
    return;
  }
  const sumNet = lines.reduce((s, l) => s + l.net, 0n);
  const sumTax = lines.reduce((s, l) => s + l.tax, 0n);

  const lineExt = amountOf(monetary, "LineExtensionAmount", c, "LegalMonetaryTotal");
  const taxExclusive = amountOf(monetary, "TaxExclusiveAmount", c, "LegalMonetaryTotal");
  const taxInclusive = amountOf(monetary, "TaxInclusiveAmount", c, "LegalMonetaryTotal");
  const allowance = amountOf(monetary, "AllowanceTotalAmount", c, "LegalMonetaryTotal") ?? 0n;
  const prepaid = amountOf(monetary, "PrepaidAmount", c, "LegalMonetaryTotal") ?? 0n;
  const payable = amountOf(monetary, "PayableAmount", c, "LegalMonetaryTotal");

  if (lineExt !== undefined && lineExt !== sumNet) c.error("BR_CO_10", `LineExtensionAmount ${formatHundredths(lineExt)} is not the sum of the line amounts ${formatHundredths(sumNet)}`);
  if (taxExclusive !== undefined && lineExt !== undefined && taxExclusive !== lineExt - allowance) c.error("BR_CO_13", `TaxExclusiveAmount ${formatHundredths(taxExclusive)} is not LineExtensionAmount minus allowances`);

  const docTaxTotals = children(root, "cac", "TaxTotal");
  if (docTaxTotals.length === 0) c.error("TAX_TOTAL_MISSING", "The document has no cac:TaxTotal");
  const taxTotalAmounts = docTaxTotals.map((t) => amountOf(t, "TaxAmount", c, "Document TaxTotal"));
  for (const amount of taxTotalAmounts) {
    if (amount !== undefined && amount !== sumTax) c.error("BR_CO_14", `A document TaxTotal of ${formatHundredths(amount)} is not the sum of the line taxes ${formatHundredths(sumTax)}`);
  }
  if (taxInclusive !== undefined && taxExclusive !== undefined && taxInclusive !== taxExclusive + sumTax) c.error("BR_CO_15", `TaxInclusiveAmount ${formatHundredths(taxInclusive)} is not TaxExclusiveAmount plus the tax ${formatHundredths(sumTax)}`);
  if (payable !== undefined && taxInclusive !== undefined && payable !== taxInclusive - prepaid) c.error("BR_CO_16", `PayableAmount ${formatHundredths(payable)} is not TaxInclusiveAmount minus prepayments`);

  // The breakdown per tax category must reproduce the lines.
  const subtotals = docTaxTotals.flatMap((t) => children(t, "cac", "TaxSubtotal"));
  if (subtotals.length === 0) c.error("TAX_SUBTOTAL_MISSING", "The document has no cac:TaxSubtotal breakdown");
  const fromLines = new Map<string, { net: bigint; tax: bigint }>();
  for (const l of lines) {
    const g = fromLines.get(l.key) ?? { net: 0n, tax: 0n };
    fromLines.set(l.key, { net: g.net + l.net, tax: g.tax + l.tax });
  }
  const seen = new Set<string>();
  for (const sub of subtotals) {
    const cat = children(sub, "cac", "TaxCategory")[0];
    const catId = cat ? childText(cat, "cbc", "ID") : undefined;
    const percent = toHundredths(cat ? childText(cat, "cbc", "Percent") : undefined);
    if (!cat || !catId || percent === undefined) {
      c.error("SUBTOTAL_CATEGORY_MISSING", "A TaxSubtotal has no usable tax category or percent");
      continue;
    }
    const key = `${catId}|${percent.toString()}`;
    seen.add(key);
    const expected = fromLines.get(key);
    const taxable = amountOf(sub, "TaxableAmount", c, `TaxSubtotal ${catId}`);
    const tax = amountOf(sub, "TaxAmount", c, `TaxSubtotal ${catId}`);
    if (!expected) c.error("BR_CO_17_UNKNOWN_CATEGORY", `A TaxSubtotal for category ${catId} at ${formatHundredths(percent)}% has no matching line`);
    else {
      if (taxable !== undefined && taxable !== expected.net) c.error("BR_CO_17_TAXABLE", `TaxSubtotal ${catId}: taxable ${formatHundredths(taxable)} is not the lines' ${formatHundredths(expected.net)}`);
      if (tax !== undefined && tax !== expected.tax) c.error("BR_CO_17_TAX", `TaxSubtotal ${catId}: tax ${formatHundredths(tax)} is not the lines' ${formatHundredths(expected.tax)}`);
    }
    if (catId === "S" && percent <= 0n) c.error("STANDARD_RATE_ZERO", "A standard-rated (S) category must have a percent above 0");
    if (catId !== "S" && percent !== 0n) c.error("NON_STANDARD_RATE_NOT_ZERO", `Category ${catId} must have a percent of 0`);
    if ((catId === "Z" || catId === "E") && !childText(cat, "cbc", "TaxExemptionReasonCode")) c.error("EXEMPTION_REASON_MISSING", `Category ${catId} needs a TaxExemptionReasonCode`);
  }
  for (const key of fromLines.keys()) {
    if (!seen.has(key)) c.error("SUBTOTAL_MISSING_FOR_LINES", `Lines use tax group ${key.replace("|", " at ")} (hundredths of a percent) but no TaxSubtotal covers it`);
  }
}

function checkCurrencyAttributes(doc: Document, root: Element, c: IssueCollector): void {
  const docCurrency = childText(root, "cbc", "DocumentCurrencyCode");
  if (!docCurrency) {
    c.error("CURRENCY_MISSING", "cbc:DocumentCurrencyCode is missing");
    return;
  }
  const all = doc.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    const attr = el.getAttribute("currencyID");
    if (attr && attr !== docCurrency) {
      c.error("CURRENCY_MISMATCH", `<${el.tagName}> is in ${attr} but the document currency is ${docCurrency}`);
      return;
    }
  }
}
