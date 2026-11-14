import { newId } from "@erp/shared";
import { buildComplianceSamples } from "../onboarding/compliance-samples.js";
import { generateTestCertificate } from "../testing/fixtures.js";
import { buildBareInvoiceXml } from "./invoice-xml-builder.js";
import { signInvoiceXml } from "./xades-signature.js";
import { invoiceQrArtifact, readInvoiceArtifacts } from "./invoice-artifacts.js";

const samples = buildComplianceSamples({ registrationName: "Test seller", vatNumber: "399999999900003", address: { streetName: "King Road", buildingNumber: "1234", citySubdivisionName: "Olaya", cityName: "Riyadh", postalZone: "12345", countryCode: "SA" } }, new Date("2026-11-14T10:00:00Z"), newId);
const cert = generateTestCertificate();
function signed(simplified: boolean): string {
  const sample = samples.find((entry) => entry.isSimplified === simplified)!;
  return signInvoiceXml(buildBareInvoiceXml(sample.input), { ...cert, isSimplified: simplified, signingTime: sample.signingTime, qr: sample.qr }).signedXml;
}

it("uses a simplified invoice's signed QR before reporting", () => {
  const xml = signed(true);
  expect(invoiceQrArtifact(xml, null)).toEqual({ qr: readInvoiceArtifacts(xml).qr, source: "SIGNED" });
});
it("never substitutes the standard pre-clearance QR or a canned invoice for the authority QR", () => {
  const xml = signed(false);
  expect(invoiceQrArtifact(xml, null)).toBeNull();
  expect(invoiceQrArtifact(xml, "<Invoice>canned</Invoice>")).toBeNull();
  expect(invoiceQrArtifact(xml, xml.replace(readInvoiceArtifacts(xml).uuid, newId()))).toBeNull();
  expect(invoiceQrArtifact(xml, xml)).toEqual({ qr: readInvoiceArtifacts(xml).qr, source: "CLEARED" });
});
it("refuses ambiguous document identities and malformed QR encodings", () => {
  const xml = signed(true);
  expect(invoiceQrArtifact(xml.replace("</cbc:UUID>", "</cbc:UUID><cbc:UUID>second</cbc:UUID>"), null)).toBeNull();
  expect(invoiceQrArtifact(xml.replace(readInvoiceArtifacts(xml).qr!, "invalid!"), null)).toBeNull();
});
