import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBareInvoiceXml } from "../xml/invoice-xml-builder.js";
import type { ZatcaInvoiceInput } from "../xml/invoice-xml.types.js";
import { signInvoiceXml } from "../xml/xades-signature.js";
import { SDK_CERTS, SDK_ROOT, SDK_SAMPLES, describeIfSdk } from "../testing/fixtures.js";
import { findSdkJar, parseSdkVerdict, runSdkValidation } from "./sdk-validator.js";

describe("parseSdkVerdict", () => {
  it("reads PASSED and FAILED from the verdict line", () => {
    expect(parseSdkVerdict("...\nINFO - GLOBAL VALIDATION RESULT = PASSED\n")).toBe("PASSED");
    expect(parseSdkVerdict("GLOBAL VALIDATION RESULT = FAILED")).toBe("FAILED");
  });

  it("never reports a pass without a recognised verdict line", () => {
    expect(parseSdkVerdict("")).toBe("UNKNOWN");
    expect(parseSdkVerdict("everything looks great, PASSED")).toBe("UNKNOWN");
    expect(parseSdkVerdict("Exception in thread main")).toBe("UNKNOWN");
  });
});

// NOT run in the session that wrote it (no SDK there). Needs the SDK under docs/vendor/zatca/sdk
// (or ZATCA_SDK_DIR) and `java` on PATH.
describeIfSdk("the official SDK validates our documents", () => {
  const jar = findSdkJar(SDK_ROOT);
  const workDir = mkdtempSync(join(tmpdir(), "zatca-sdk-validate-"));
  afterAll(() => rmSync(workDir, { recursive: true, force: true }));

  it("finds the SDK jar", () => {
    expect(jar).toBeDefined();
  });

  it("harness sanity: the SDK accepts its own Standard_Invoice.xml sample", async () => {
    const result = await runSdkValidation({ sdkDir: SDK_ROOT, xmlPath: join(SDK_SAMPLES, "Standard", "Invoice", "Standard_Invoice.xml") });
    // If this is UNKNOWN the harness (flags / verdict pattern), not the invoice, needs fixing: read result.output.
    expect({ verdict: result.verdict, output: result.verdict === "PASSED" ? "" : result.output }).toEqual({ verdict: "PASSED", output: "" });
  });

  it("our builder + signer output, signed with the SDK's own sample key and certificate, is accepted", async () => {
    const input: ZatcaInvoiceInput = {
      subtype: "STANDARD",
      documentType: "INVOICE",
      id: "SME00023",
      uuid: "8d487816-70b8-4ade-a618-9d620b73814a",
      issueDate: "2026-11-04",
      issueTime: "12:21:28",
      currency: "SAR",
      icv: "23",
      previousInvoiceHash: "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==",
      supplier: {
        partyIdentification: { schemeId: "CRN", id: "1010010000" },
        address: { streetName: "Prince Sultan", buildingNumber: "2322", citySubdivisionName: "Al-Murabba", cityName: "Riyadh", postalZone: "23333", countryCode: "SA" },
        vatNumber: "399999999900003",
        registrationName: "Maximum Speed Tech Supply LTD",
      },
      customer: {
        address: { streetName: "Salah Al-Din", buildingNumber: "1111", citySubdivisionName: "Al-Murooj", cityName: "Riyadh", postalZone: "12222", countryCode: "SA" },
        vatNumber: "399999999800003",
        registrationName: "Fatoora Samples LTD",
      },
      actualDeliveryDate: "2026-11-04",
      paymentMeansCode: "10",
      lines: [{ id: "1", quantity: "2.000000", unitCode: "PCE", lineExtensionAmount: "4.00", taxAmount: "0.60", itemName: "Pencil", taxCategoryId: "S", taxPercent: "15.00", priceAmount: "2.00" }],
    };
    const { signedXml } = signInvoiceXml(buildBareInvoiceXml(input), {
      certificatePem: readFileSync(join(SDK_CERTS, "cert.pem"), "utf8"),
      privateKeyPem: readFileSync(join(SDK_CERTS, "ec-secp256k1-priv-key.pem"), "utf8"),
      signingTime: "2026-11-04T12:21:28",
      isSimplified: false,
      qr: { sellerName: "Maximum Speed Tech Supply LTD", vatNumber: "399999999900003", timestamp: "2026-11-04T12:21:28", invoiceTotalWithVat: "4.60", vatTotal: "0.60" },
    });
    const path = join(workDir, "ours.xml");
    writeFileSync(path, signedXml, "utf8");
    const result = await runSdkValidation({ sdkDir: SDK_ROOT, xmlPath: path });
    expect({ verdict: result.verdict, output: result.verdict === "PASSED" ? "" : result.output }).toEqual({ verdict: "PASSED", output: "" });
  });
});
