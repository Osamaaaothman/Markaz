import { X509Certificate } from "node:crypto";
import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { decryptText } from "../key-encryption.js";
import type { ZatcaInvoiceInput, ZatcaParty } from "../xml/invoice-xml.types.js";
import { OnboardingError, OnboardingService, type StartOnboardingParams } from "./onboarding.service.js";
import { ZatcaOnboardingApiClient, type CsidResponseBody, type ComplianceCheckResponseBody } from "./onboarding-api-client.js";
import type { HttpResponse, HttpTransport } from "../http/zatca-http-transport.js";
import { ZatcaApiError } from "../http/zatca-http-transport.js";
import { generateTestCertificate } from "../testing/fixtures.js";

const describeIfReady = process.env.DATABASE_URL ? describe : describe.skip;

// Scripted, never-real-network transport (docs/06-COMPLIANCE-PACK-RULES.md §6) — same pattern as
// ../submission/invoice-submission.service.spec.ts's ScriptedTransport.
class ScriptedTransport implements HttpTransport {
  private readonly script: (HttpResponse | Error)[] = [];
  readonly calls: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];

  queue(...responses: (HttpResponse | Error)[]): this {
    this.script.push(...responses);
    return this;
  }

  request(method: "POST" | "PATCH", url: string, headers: Record<string, string>, body: unknown): Promise<HttpResponse> {
    this.calls.push({ method, url, headers, body });
    const next = this.script.shift();
    if (!next) throw new Error("ScriptedTransport ran out of queued responses");
    if (next instanceof Error) throw next;
    return Promise.resolve(next);
  }
}

const ENCRYPTION_KEY = Buffer.from("k".repeat(32), "utf8");

describeIfReady("OnboardingService — real database, scripted ZATCA transport", () => {
  const prisma = new PrismaClient();
  const companyId = newId();
  let egsUnitId: string;

  // A generated certificate (testing/fixtures.ts) — used as the "server-issued" certificate in every
  // scripted response below. Its public key does NOT correspond to the private key this
  // service generates for itself in `startOnboarding` (there is no test CA to issue a matching
  // one) — fine for these tests, which verify the orchestration (encryption, status
  // transitions, request/response wiring, error classification), not cryptographic round-trip
  // fidelity between a generated key and a server-issued cert. That fidelity is what
  // ../xml/xades-signature.spec.ts already proves, against the SDK's own matching key+cert pair.
  const testCertificate = generateTestCertificate();
  const sdkCertBase64 = testCertificate.certificateBase64;

  const csrInput: StartOnboardingParams["csr"] = {
    commonName: "Till-1",
    organizationUnit: "Riyadh Branch",
    organizationName: "Maximum Speed Tech Supply LTD",
    countryCode: "SA",
    egsSerial: "1-MarkazPOS|2-M1|3-ed22f1d8-e6a2-1118-9b58-d9a8f11e445f",
    vatNumber: "399999999900003",
    invoiceTypeDigits: "1100",
    location: "RRRD2929",
    businessCategory: "Retail",
  };

  const supplier: ZatcaParty = {
    partyIdentification: { schemeId: "CRN", id: "1010010000" },
    address: { streetName: "Prince Sultan", buildingNumber: "2322", citySubdivisionName: "Al-Murabba", cityName: "Riyadh", postalZone: "23333", countryCode: "SA" },
    vatNumber: "399999999900003",
    registrationName: "Maximum Speed Tech Supply LTD",
  };
  const customer: ZatcaParty = {
    address: { streetName: "Salah Al-Din", buildingNumber: "1111", citySubdivisionName: "Al-Murooj", cityName: "Riyadh", postalZone: "12222", countryCode: "SA" },
    vatNumber: "399999999800003",
    registrationName: "Fatoora Samples LTD",
  };
  const sampleInvoice: ZatcaInvoiceInput = {
    subtype: "STANDARD",
    documentType: "INVOICE",
    id: "COMPLIANCE-SAMPLE-1",
    uuid: newId(),
    issueDate: "2026-11-05",
    issueTime: "12:00:00",
    currency: "SAR",
    icv: "1",
    previousInvoiceHash: "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==",
    supplier,
    customer,
    paymentMeansCode: "10",
    lines: [{ id: "1", quantity: "1", unitCode: "PCE", lineExtensionAmount: "4.00", taxAmount: "0.60", itemName: "Item", taxCategoryId: "S", taxPercent: "15.00", priceAmount: "4.00" }],
  };

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Onboarding Test ${companyId}`, defaultCurrency: "SAR" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const egsUnit = await prisma.egsUnit.create({
      data: { id: newId(), companyId, name: "Till", serial: `1-MarkazPOS|2-M1|3-${newId()}`, businessCategory: "Retail", invoiceTypes: "1100", environment: "sandbox" },
    });
    egsUnitId = egsUnit.id;
  });

  function makeService(transport: ScriptedTransport): OnboardingService {
    return new OnboardingService(prisma, ENCRYPTION_KEY, (environment) => new ZatcaOnboardingApiClient(environment, transport));
  }

  it("startOnboarding generates a key/CSR, requests a compliance CSID, and stores everything encrypted", async () => {
    const transport = new ScriptedTransport().queue({
      status: 200,
      body: { requestID: "req-1", binarySecurityToken: sdkCertBase64, secret: "compliance-secret" } satisfies CsidResponseBody,
    });
    const service = makeService(transport);

    const result = await service.startOnboarding({ companyId, egsUnitId, environment: "sandbox", otp: "123345", csr: csrInput, certificateTemplateName: "TSTZATCA-Code-Signing" });

    expect(result.complianceRequestId).toBe("req-1");
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]!.headers.OTP).toBe("123345");
    expect(transport.calls[0]!.headers["Accept-Version"]).toBe("V2");

    const credential = await prisma.egsCredential.findUniqueOrThrow({ where: { egsUnitId } });
    expect(credential.status).toBe("COMPLIANCE_CSID_ISSUED");
    expect(credential.complianceRequestId).toBe("req-1");
    // Nothing is plaintext — docs/09-SECURITY-RULES.md §5.
    expect(Buffer.from(credential.privateKeyCiphertext!).toString("utf8")).not.toContain("BEGIN EC PRIVATE KEY");
    expect(decryptText(credential.privateKeyCiphertext!, ENCRYPTION_KEY)).toContain("-----BEGIN EC PRIVATE KEY-----");
    expect(decryptText(credential.complianceCsidCiphertext!, ENCRYPTION_KEY)).toContain("-----BEGIN CERTIFICATE-----");
    expect(decryptText(credential.complianceSecretCiphertext!, ENCRYPTION_KEY)).toBe("compliance-secret");
  });

  it("runComplianceCheck signs and submits the sample invoice, and refuses to proceed without a compliance CSID", async () => {
    const serviceWithoutOnboarding = makeService(new ScriptedTransport());
    await expect(
      serviceWithoutOnboarding.runComplianceCheck({ egsUnitId, environment: "sandbox", isSimplified: false, signingTime: "2026-11-05T12:00:00", qr: { sellerName: "x", vatNumber: "x", timestamp: "x", invoiceTotalWithVat: "4.60", vatTotal: "0.60" }, sampleInvoice }),
    ).rejects.toBeInstanceOf(OnboardingError);

    const onboardTransport = new ScriptedTransport().queue({ status: 200, body: { requestID: "req-2", binarySecurityToken: sdkCertBase64, secret: "compliance-secret" } satisfies CsidResponseBody });
    const service = makeService(onboardTransport);
    await service.startOnboarding({ companyId, egsUnitId, environment: "sandbox", otp: "123345", csr: csrInput, certificateTemplateName: "TSTZATCA-Code-Signing" });

    const checkTransport = new ScriptedTransport().queue({
      status: 200,
      body: { clearanceStatus: "CLEARED", validationResults: { status: "PASS", warningMessages: [], errorMessages: [] } } satisfies ComplianceCheckResponseBody,
    });
    const checkService = new OnboardingService(prisma, ENCRYPTION_KEY, (environment) => new ZatcaOnboardingApiClient(environment, checkTransport));
    await expect(
      checkService.runComplianceCheck({ egsUnitId, environment: "sandbox", isSimplified: false, signingTime: "2026-11-05T12:00:00", qr: { sellerName: "Maximum Speed Tech Supply LTD", vatNumber: "399999999900003", timestamp: "2026-11-05T12:00:00", invoiceTotalWithVat: "4.60", vatTotal: "0.60" }, sampleInvoice }),
    ).resolves.toMatchObject({ clearanceStatus: "CLEARED" });

    expect(checkTransport.calls).toHaveLength(1);
    const body = checkTransport.calls[0]!.body as { uuid: string; invoice: string };
    expect(body.uuid).toBe(sampleInvoice.uuid);
    expect(Buffer.from(body.invoice, "base64").toString("utf8")).toContain("<Invoice");
  });

  it("runComplianceCheck throws OnboardingError when ZATCA rejects the sample — never fabricates a pass", async () => {
    const onboardTransport = new ScriptedTransport().queue({ status: 200, body: { requestID: "req-3", binarySecurityToken: sdkCertBase64, secret: "s" } satisfies CsidResponseBody });
    const service = makeService(onboardTransport);
    await service.startOnboarding({ companyId, egsUnitId, environment: "sandbox", otp: "123345", csr: csrInput, certificateTemplateName: "TSTZATCA-Code-Signing" });

    const checkTransport = new ScriptedTransport().queue({
      status: 200,
      body: { clearanceStatus: "NOT_CLEARED", validationResults: { status: "ERROR", warningMessages: [], errorMessages: ["bad VAT number"] } } satisfies ComplianceCheckResponseBody,
    });
    const checkService = new OnboardingService(prisma, ENCRYPTION_KEY, (environment) => new ZatcaOnboardingApiClient(environment, checkTransport));
    await expect(
      checkService.runComplianceCheck({ egsUnitId, environment: "sandbox", isSimplified: false, signingTime: "2026-11-05T12:00:00", qr: { sellerName: "x", vatNumber: "x", timestamp: "x", invoiceTotalWithVat: "4.60", vatTotal: "0.60" }, sampleInvoice }),
    ).rejects.toMatchObject({ code: "COMPLIANCE_CHECK_FAILED" });

    // Status was never advanced past COMPLIANCE_CSID_ISSUED by a failed check.
    const credential = await prisma.egsCredential.findUniqueOrThrow({ where: { egsUnitId } });
    expect(credential.status).toBe("COMPLIANCE_CSID_ISSUED");
  });

  it("requestProductionCsid refuses before compliance checks are marked passed, then succeeds and sets the certificate's real expiry", async () => {
    const onboardTransport = new ScriptedTransport().queue({ status: 200, body: { requestID: "req-4", binarySecurityToken: sdkCertBase64, secret: "compliance-secret" } satisfies CsidResponseBody });
    const service = makeService(onboardTransport);
    await service.startOnboarding({ companyId, egsUnitId, environment: "sandbox", otp: "123345", csr: csrInput, certificateTemplateName: "TSTZATCA-Code-Signing" });

    await expect(service.requestProductionCsid(egsUnitId, "sandbox")).rejects.toMatchObject({ code: "WRONG_STATUS" });

    await service.markComplianceChecksPassed(egsUnitId);
    const afterMark = await prisma.egsCredential.findUniqueOrThrow({ where: { egsUnitId } });
    expect(afterMark.status).toBe("COMPLIANCE_CHECKS_PASSED");

    const prodTransport = new ScriptedTransport().queue({ status: 200, body: { requestID: "req-4", binarySecurityToken: sdkCertBase64, secret: "production-secret" } satisfies CsidResponseBody });
    const prodService = new OnboardingService(prisma, ENCRYPTION_KEY, (environment) => new ZatcaOnboardingApiClient(environment, prodTransport));
    await prodService.requestProductionCsid(egsUnitId, "sandbox");

    // Authenticated with the COMPLIANCE csid/secret, not the OTP.
    expect(prodTransport.calls[0]!.headers.Authorization).toMatch(/^Basic /);
    expect(prodTransport.calls[0]!.headers.OTP).toBeUndefined();

    const credential = await prisma.egsCredential.findUniqueOrThrow({ where: { egsUnitId } });
    expect(credential.status).toBe("ACTIVE");
    expect(decryptText(credential.productionSecretCiphertext!, ENCRYPTION_KEY)).toBe("production-secret");
    // Parsed from the certificate itself, not a placeholder: must equal the certificate's own NotAfter.
    expect(credential.certificateExpiresAt?.getTime()).toBe(new X509Certificate(testCertificate.certificatePem).validToDate.getTime());
  });

  it("renewProductionCsid reuses the existing private key and updates the stored certificate", async () => {
    const onboardTransport = new ScriptedTransport().queue({ status: 200, body: { requestID: "req-5", binarySecurityToken: sdkCertBase64, secret: "compliance-secret" } satisfies CsidResponseBody });
    const service = makeService(onboardTransport);
    await service.startOnboarding({ companyId, egsUnitId, environment: "sandbox", otp: "123345", csr: csrInput, certificateTemplateName: "TSTZATCA-Code-Signing" });
    await service.markComplianceChecksPassed(egsUnitId);

    const prodTransport = new ScriptedTransport().queue({ status: 200, body: { requestID: "req-5", binarySecurityToken: sdkCertBase64, secret: "production-secret-1" } satisfies CsidResponseBody });
    await new OnboardingService(prisma, ENCRYPTION_KEY, (environment) => new ZatcaOnboardingApiClient(environment, prodTransport)).requestProductionCsid(egsUnitId, "sandbox");

    const beforeRenewal = await prisma.egsCredential.findUniqueOrThrow({ where: { egsUnitId } });
    const keyBeforeRenewal = decryptText(beforeRenewal.privateKeyCiphertext!, ENCRYPTION_KEY);

    const renewTransport = new ScriptedTransport().queue({ status: 200, body: { requestID: "req-5", binarySecurityToken: sdkCertBase64, secret: "production-secret-2" } satisfies CsidResponseBody });
    const renewService = new OnboardingService(prisma, ENCRYPTION_KEY, (environment) => new ZatcaOnboardingApiClient(environment, renewTransport));
    await renewService.renewProductionCsid(egsUnitId, "sandbox", "123345", { ...csrInput, certificateTemplateName: "TSTZATCA-Code-Signing" });

    expect(renewTransport.calls[0]!.method).toBe("PATCH");
    expect(renewTransport.calls[0]!.headers.OTP).toBe("123345");

    const afterRenewal = await prisma.egsCredential.findUniqueOrThrow({ where: { egsUnitId } });
    expect(decryptText(afterRenewal.privateKeyCiphertext!, ENCRYPTION_KEY)).toBe(keyBeforeRenewal); // same key, not regenerated
    expect(decryptText(afterRenewal.productionSecretCiphertext!, ENCRYPTION_KEY)).toBe("production-secret-2");
    expect(afterRenewal.lastRenewalAt).not.toBeNull();
  });

  it("surfaces a transient transport failure as a thrown ZatcaApiError, not a fabricated success", async () => {
    const transport = new ScriptedTransport().queue(new ZatcaApiError("SERVER_ERROR", "ZATCA is down", 503));
    const service = makeService(transport);
    await expect(service.startOnboarding({ companyId, egsUnitId, environment: "sandbox", otp: "123345", csr: csrInput, certificateTemplateName: "TSTZATCA-Code-Signing" })).rejects.toBeInstanceOf(ZatcaApiError);
    expect(await prisma.egsCredential.findUnique({ where: { egsUnitId } })).toBeNull();
  });
});
