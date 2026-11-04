// A tiny read-only view over a UBL invoice document, shared by the validators in this folder.
// Parsing uses @xmldom/xmldom (already a dependency of the canonicalizer); nothing here builds or
// changes XML.
import { DOMParser } from "@xmldom/xmldom";

export const NS = {
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  ds: "http://www.w3.org/2000/09/xmldsig#",
  xades: "http://uri.etsi.org/01903/v1.3.2#",
} as const;

export type Ns = keyof typeof NS;

export function parseXml(xml: string): Document {
  const errors: string[] = [];
  const doc = new DOMParser({
    errorHandler: {
      // xmldom 0.8 reports some malformed input (e.g. an unclosed tag) only as a warning, so a warning is treated as a failure too.
      warning: (message: string) => errors.push(message),
      error: (message: string) => errors.push(message),
      fatalError: (message: string) => errors.push(message),
    },
  }).parseFromString(xml, "text/xml");
  if (errors.length > 0 || !doc.documentElement) {
    throw new Error(`The document is not well-formed XML: ${errors[0] ?? "no root element"}`);
  }
  return doc;
}

export function descendants(scope: Document | Element, ns: Ns, localName: string): Element[] {
  return Array.from(scope.getElementsByTagNameNS(NS[ns], localName));
}

export function firstDescendant(scope: Document | Element, ns: Ns, localName: string): Element | undefined {
  return descendants(scope, ns, localName)[0];
}

// Direct children only -- distinguishes the document-level cac:TaxTotal from the ones inside lines.
export function children(scope: Element, ns: Ns, localName: string): Element[] {
  return Array.from(scope.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).namespaceURI === NS[ns] && (n as Element).localName === localName);
}

export function textOf(el: Element | undefined): string | undefined {
  return el?.textContent?.trim() ?? undefined;
}

// Exact decimal arithmetic in integer hundredths: amounts in these documents are always 2 decimal
// places, and a float here would defeat the purpose of the check.
export function toHundredths(value: string | undefined): bigint | undefined {
  if (value === undefined) return undefined;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const cents = BigInt(match[2]!) * 100n + BigInt((match[3] ?? "").padEnd(2, "0") || "0");
  return match[1] === "-" ? -cents : cents;
}

export function formatHundredths(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}
