import { invoiceIssueProblems } from "./invoice-issue-readiness.js";
import type { ZatcaParty } from "../xml/invoice-xml.types.js";

const supplier: ZatcaParty = {
  registrationName: "Seller",
  vatNumber: "399999999900003",
  partyIdentification: { schemeId: "CRN", id: "1010010000" },
  address: {
    streetName: "King Road",
    buildingNumber: "1234",
    citySubdivisionName: "Olaya",
    cityName: "Riyadh",
    postalZone: "12345",
    countryCode: "SA",
  },
};
const customer: ZatcaParty = {
  ...supplier,
  registrationName: "Buyer",
  vatNumber: "399999999800003",
};
const valid = {
  documentType: "INVOICE" as const,
  supplier,
  customer,
  actualDeliveryDate: "2026-11-15",
};

it("requires an explicit supply date only for standard invoices, with no inferred fallback", () => {
  expect(invoiceIssueProblems(valid)).toEqual([]);
  expect(invoiceIssueProblems({ ...valid, actualDeliveryDate: undefined })).toEqual([
    "COMPLIANCE_SUPPLY_DATE_REQUIRED",
  ]);
  expect(invoiceIssueProblems({ ...valid, actualDeliveryDate: "2026-02-30" })).toEqual([
    "COMPLIANCE_SUPPLY_DATE_INVALID",
  ]);
  for (const documentType of ["CREDIT_NOTE", "DEBIT_NOTE"] as const)
    expect(invoiceIssueProblems({ ...valid, documentType, actualDeliveryDate: undefined })).toEqual(
      [],
    );
  expect(
    invoiceIssueProblems({ ...valid, customer: undefined, actualDeliveryDate: undefined }),
  ).toEqual([]);
});

it("rejects the known VAT, registration and Saudi address failures before generation", () => {
  for (const vatNumber of ["123456789012345", "399999999900000", "3999", "3ABCDEFGHIJKLM3"])
    expect(invoiceIssueProblems({ ...valid, customer: { ...customer, vatNumber } })).toContain(
      "COMPLIANCE_BUYER_VAT_INVALID",
    );
  expect(
    invoiceIssueProblems({ ...valid, supplier: { ...supplier, vatNumber: undefined } }),
  ).toContain("COMPLIANCE_SELLER_VAT_INVALID");
  for (const role of ["supplier", "customer"] as const) {
    const problemRole = role === "supplier" ? "SELLER" : "BUYER";
    expect(
      invoiceIssueProblems({
        ...valid,
        [role]: { ...supplier, partyIdentification: { schemeId: "CRN", id: "invalid" } },
      }),
    ).toContain(`COMPLIANCE_${problemRole}_CR_INVALID`);
    expect(
      invoiceIssueProblems({
        ...valid,
        [role]: { ...supplier, address: { ...supplier.address, postalZone: "123" } },
      }),
    ).toContain(`COMPLIANCE_${problemRole}_ADDRESS_INVALID`);
    expect(
      invoiceIssueProblems({
        ...valid,
        [role]: { ...supplier, address: { ...supplier.address, streetName: "" } },
      }),
    ).toContain(`COMPLIANCE_${problemRole}_ADDRESS_INVALID`);
  }
});
