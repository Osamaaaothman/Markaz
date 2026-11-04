import { buildBareInvoiceXml } from "../xml/invoice-xml-builder.js";
import { checkInvoiceConsistency } from "../validation/invoice-consistency.js";
import { buildComplianceSamples, riyadhDateTime } from "./compliance-samples.js";

const seller = {
  partyIdentification: { schemeId: "CRN", id: "1010010000" },
  address: { streetName: "Prince Sultan", buildingNumber: "2322", citySubdivisionName: "Al-Murabba", cityName: "Riyadh", postalZone: "23333", countryCode: "SA" },
  vatNumber: "399999999900003",
  registrationName: "Maximum Speed Tech Supply LTD",
};

describe("buildComplianceSamples", () => {
  let n = 0;
  const samples = buildComplianceSamples(seller, new Date("2026-11-04T21:30:00Z"), () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);

  it("covers the six document types, once each, with distinct ICVs and UUIDs", () => {
    expect(samples.map((s) => s.label)).toEqual([
      "STANDARD_INVOICE", "STANDARD_CREDIT_NOTE", "STANDARD_DEBIT_NOTE", "SIMPLIFIED_INVOICE", "SIMPLIFIED_CREDIT_NOTE", "SIMPLIFIED_DEBIT_NOTE",
    ]);
    expect(new Set(samples.map((s) => s.input.icv)).size).toBe(6);
    expect(new Set(samples.map((s) => s.input.uuid)).size).toBe(6);
  });

  it("every sample builds XML that passes our own consistency checks and carries the seller's real identity", () => {
    for (const sample of samples) {
      const xml = buildBareInvoiceXml(sample.input);
      expect(checkInvoiceConsistency(xml)).toEqual({ valid: true, issues: [] });
      expect(xml).toContain("399999999900003");
      expect(sample.qr.sellerName).toBe(seller.registrationName);
      expect(sample.qr.invoiceTotalWithVat).toBe("115.00");
    }
  });

  it("gives a simplified sample no buyer, and a credit/debit note its billing reference and reason", () => {
    expect(samples.filter((s) => s.isSimplified).every((s) => s.input.customer === undefined)).toBe(true);
    for (const s of samples.filter((x) => x.input.documentType !== "INVOICE")) {
      expect(s.input.billingReference).toBeDefined();
      expect(s.input.instructionNote).toBeTruthy();
    }
  });
});

describe("riyadhDateTime", () => {
  it("is UTC+3, crossing midnight correctly", () => {
    expect(riyadhDateTime(new Date("2026-11-04T21:30:00Z"))).toEqual({ date: "2026-11-05", time: "00:30:00" });
    expect(riyadhDateTime(new Date("2026-11-04T08:00:00Z"))).toEqual({ date: "2026-11-04", time: "11:00:00" });
  });
});
