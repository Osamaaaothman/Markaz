// XML canonicalization (C14N) — the one step this phase cannot safely hand-roll (whitespace,
// attribute ordering, and namespace-declaration inheritance rules are exactly the kind of
// subtlety that silently breaks a hash chain). Uses xml-crypto's C14nCanonicalization, which
// implements inclusive C14N 1.0 (http://www.w3.org/TR/2001/REC-xml-c14n-20010315). ZATCA's own
// samples declare C14N **1.1** (http://www.w3.org/2006/12/xml-c14n11) as the algorithm; the two
// specs differ only in how they rebase inherited `xml:base`/`xml:lang`/`xml:space` attributes
// across a removed ancestor, which none of our documents ever use, so 1.0's output is
// byte-identical to 1.1's for anything this package produces. Verified empirically, not just
// argued: canonicalize-hash.spec.ts reproduces the official sample's own signed digest exactly.
import { C14nCanonicalization } from "xml-crypto";
import { DOMParser } from "@xmldom/xmldom";

export function canonicalizeXml(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const canonicalizer = new C14nCanonicalization();
  return canonicalizer.process(doc.documentElement, {});
}

// Canonicalizes a single element found by `localName` (e.g. the ds:SignedInfo fragment that
// must be canonicalized on its own before it is signed) rather than the whole document.
export function canonicalizeElementByLocalName(xml: string, namespaceUri: string, localName: string): string {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const element = doc.getElementsByTagNameNS(namespaceUri, localName)[0];
  if (!element) {
    throw new Error(`No <${localName}> element found in the given XML (namespace ${namespaceUri})`);
  }
  const canonicalizer = new C14nCanonicalization();
  return canonicalizer.process(element, {});
}
