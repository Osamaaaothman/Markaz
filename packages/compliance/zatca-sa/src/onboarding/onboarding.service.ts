// Orchestrates one EGS unit's onboarding: CSR → compliance CSID → compliance checks →
// production CSID, persisting every secret encrypted (docs/09-SECURITY-RULES.md §5 /
// docs/SECURITY.md) and advancing `EgsCredential.status` through the lifecycle
// docs/01-OPEN-DECISIONS.md section S already named: NEW -> CSR_GENERATED ->
// COMPLIANCE_CSID_ISSUED -> COMPLIANCE_CHECKS_PASSED -> PRODUCTION_CSID_ISSUED -> ACTIVE.
//
// Deliberately does not decide WHICH sample invoices to submit for the compliance check, or
// build them itself — the caller supplies each one (docs/06-COMPLIANCE-PACK-RULES.md's
// non-negotiable "never fabricate" extends to compliance-check documents too; this service only
// knows how to sign and submit what it's given, same separation of concerns as
// InvoiceSubmissionService.buildInvoiceInput in ../submission/).
import { X509Certificate } from "node:crypto";
import { newId } from "@erp/shared";
import type { PrismaClient } from "@erp/db";
import { encryptText, decryptText } from "../key-encryption.js";
import { toPem } from "../xml/signing.js";
import { buildBareInvoiceXml } from "../xml/invoice-xml-builder.js";
import { signInvoiceXml } from "../xml/xades-signature.js";
import type { ZatcaInvoiceInput } from "../xml/invoice-xml.types.js";
import type { QrFields } from "../xml/qr.js";
import type { ZatcaEnvironment } from "../submission/zatca-environment.js";
import type { ZatcaCredentials, ClearanceRequestBody } from "../submission/zatca-api-client.js";
import { generateCsr, generateEcPrivateKeyPem, type CsrInput } from "./csr.js";
import { ZatcaOnboardingApiClient, type ComplianceCheckResponseBody } from "./onboarding-api-client.js";

export class OnboardingError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "WRONG_STATUS" | "COMPLIANCE_CHECK_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "OnboardingError";
  }
}

export interface StartOnboardingParams {
  readonly companyId: string;
  readonly egsUnitId: string;
  readonly environment: ZatcaEnvironment;
  readonly otp: string;
  readonly csr: Omit<CsrInput, "certificateTemplateName">;
  readonly certificateTemplateName: string;
  readonly acceptLanguage?: "ar" | "en";
}

export interface RunComplianceCheckParams {
  readonly egsUnitId: string;
  readonly environment: ZatcaEnvironment;
  readonly isSimplified: boolean;
  readonly signingTime: string;
  readonly qr: Pick<QrFields, "sellerName" | "vatNumber" | "timestamp" | "invoiceTotalWithVat" | "vatTotal">;
  readonly sampleInvoice: ZatcaInvoiceInput;
  readonly acceptLanguage?: "ar" | "en";
}

export class OnboardingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly encryptionKey: Buffer,
    private readonly apiClientFactory: (environment: ZatcaEnvironment) => ZatcaOnboardingApiClient = (environment) => new ZatcaOnboardingApiClient(environment),
  ) {}

  // Generates the EGS's key and CSR, requests a compliance CSID with the given OTP, and persists
  // everything encrypted. One `EgsCredential` row per EGS unit — created here if this is the
  // first onboarding attempt, or updated in place on a retry (docs/01 section S: a credential is
  // mutable, not an append-only history; the audit log is the history).
  async startOnboarding(params: StartOnboardingParams): Promise<{ egsCredentialId: string; complianceRequestId: string }> {
    const privateKeyPem = generateEcPrivateKeyPem();
    const { csrPem } = generateCsr(privateKeyPem, { ...params.csr, certificateTemplateName: params.certificateTemplateName });
    const csrBase64 = Buffer.from(csrPem, "utf8").toString("base64");

    const client = this.apiClientFactory(params.environment);
    const response = await client.requestComplianceCsid(params.otp, csrBase64, params.acceptLanguage ?? "en");

    const certificatePem = toPem(response.binarySecurityToken, "CERTIFICATE");
    const existing = await this.prisma.egsCredential.findUnique({ where: { egsUnitId: params.egsUnitId } });
    const data = {
      csr: csrPem,
      privateKeyCiphertext: toBytesColumn(encryptText(privateKeyPem, this.encryptionKey)),
      complianceRequestId: response.requestID,
      complianceCsidCiphertext: toBytesColumn(encryptText(certificatePem, this.encryptionKey)),
      complianceSecretCiphertext: toBytesColumn(encryptText(response.secret, this.encryptionKey)),
      status: "COMPLIANCE_CSID_ISSUED",
    };
    const egsCredentialId =
      existing?.id ??
      (
        await this.prisma.egsCredential.create({
          data: { id: newId(), companyId: params.companyId, egsUnitId: params.egsUnitId, ...data },
        })
      ).id;
    if (existing) {
      await this.prisma.egsCredential.update({ where: { id: existing.id }, data });
    }
    return { egsCredentialId, complianceRequestId: response.requestID };
  }

  // Signs the given sample invoice with the compliance CSID issued by `startOnboarding` and
  // submits it to the compliance-check endpoint. Throws `OnboardingError` ("COMPLIANCE_CHECK_FAILED")
  // if ZATCA's own validation rejected it — never silently treats a failure as a pass
  // (docs/06-COMPLIANCE-PACK-RULES.md §7: "never fabricate a clearance status").
  async runComplianceCheck(params: RunComplianceCheckParams): Promise<ComplianceCheckResponseBody> {
    const credential = await this.loadCredential(params.egsUnitId);
    if (!credential.privateKeyCiphertext || !credential.complianceCsidCiphertext || !credential.complianceSecretCiphertext) {
      throw new OnboardingError("WRONG_STATUS", "No compliance CSID on file for this EGS — call startOnboarding first.");
    }
    const privateKeyPem = decryptText(credential.privateKeyCiphertext, this.encryptionKey);
    const certificatePem = decryptText(credential.complianceCsidCiphertext, this.encryptionKey);
    const credentials: ZatcaCredentials = {
      binarySecurityToken: certificateBodyBase64(certificatePem),
      secret: decryptText(credential.complianceSecretCiphertext, this.encryptionKey),
    };

    const bareXml = buildBareInvoiceXml(params.sampleInvoice);
    const signed = signInvoiceXml(bareXml, {
      certificatePem,
      privateKeyPem,
      signingTime: params.signingTime,
      isSimplified: params.isSimplified,
      qr: params.qr,
    });

    const client = this.apiClientFactory(params.environment);
    const body: ClearanceRequestBody = {
      invoiceHash: signed.invoiceHash.xmldsigBase64,
      uuid: params.sampleInvoice.uuid,
      invoice: Buffer.from(signed.signedXml, "utf8").toString("base64"),
    };
    const result = await client.submitComplianceInvoice(credentials, body, params.acceptLanguage ?? "en");
    if (result.validationResults.errorMessages.length > 0 || result.clearanceStatus === "NOT_CLEARED" || result.reportingStatus === "NOT_REPORTED") {
      throw new OnboardingError("COMPLIANCE_CHECK_FAILED", `Compliance check failed for ${params.sampleInvoice.documentType}/${params.sampleInvoice.subtype}: ${result.validationResults.errorMessages.join("; ")}`);
    }
    return result;
  }

  // Marks every required compliance check as passed. The CALLER decides when that's true (it
  // ran `runComplianceCheck` once per required document type and none threw) — this service does
  // not track which of the six document types were actually exercised.
  async markComplianceChecksPassed(egsUnitId: string): Promise<void> {
    await this.prisma.egsCredential.update({ where: { egsUnitId }, data: { status: "COMPLIANCE_CHECKS_PASSED" } });
  }

  // Exchanges the compliance request ID for a production CSID. Only meaningful after
  // `markComplianceChecksPassed` — ZATCA itself would refuse this otherwise, but failing fast
  // locally on the wrong status avoids burning a real API call on a foregone rejection.
  async requestProductionCsid(egsUnitId: string, environment: ZatcaEnvironment, acceptLanguage: "ar" | "en" = "en"): Promise<void> {
    const credential = await this.loadCredential(egsUnitId);
    if (credential.status !== "COMPLIANCE_CHECKS_PASSED" || !credential.complianceRequestId || !credential.complianceCsidCiphertext || !credential.complianceSecretCiphertext) {
      throw new OnboardingError("WRONG_STATUS", `EGS ${egsUnitId} is not ready for a production CSID (status: ${credential.status}).`);
    }
    const complianceCredentials: ZatcaCredentials = {
      binarySecurityToken: certificateBodyBase64(decryptText(credential.complianceCsidCiphertext, this.encryptionKey)),
      secret: decryptText(credential.complianceSecretCiphertext, this.encryptionKey),
    };
    const client = this.apiClientFactory(environment);
    const response = await client.requestProductionCsid(complianceCredentials, credential.complianceRequestId, acceptLanguage);
    const certificatePem = toPem(response.binarySecurityToken, "CERTIFICATE");
    await this.prisma.egsCredential.update({
      where: { egsUnitId },
      data: {
        productionCsidCiphertext: toBytesColumn(encryptText(certificatePem, this.encryptionKey)),
        productionSecretCiphertext: toBytesColumn(encryptText(response.secret, this.encryptionKey)),
        status: "ACTIVE",
        certificateExpiresAt: certificateNotAfter(certificatePem),
      },
    });
  }

  // Renews an EGS's production CSID: a fresh CSR (reusing the existing key — docs/06 §5 says
  // renewal/revocation must be designed from day one, not what KEY policy a renewal uses; reusing
  // the key is the simpler of the two defensible choices and is what csr.ts's `generateCsr`
  // already supports) plus a new OTP.
  async renewProductionCsid(egsUnitId: string, environment: ZatcaEnvironment, otp: string, csrInput: StartOnboardingParams["csr"] & { certificateTemplateName: string }, acceptLanguage: "ar" | "en" = "en"): Promise<void> {
    const credential = await this.loadCredential(egsUnitId);
    if (!credential.productionCsidCiphertext || !credential.productionSecretCiphertext || !credential.privateKeyCiphertext) {
      throw new OnboardingError("WRONG_STATUS", `EGS ${egsUnitId} has no production CSID to renew.`);
    }
    const privateKeyPem = decryptText(credential.privateKeyCiphertext, this.encryptionKey);
    const { csrPem } = generateCsr(privateKeyPem, csrInput);
    const productionCredentials: ZatcaCredentials = {
      binarySecurityToken: certificateBodyBase64(decryptText(credential.productionCsidCiphertext, this.encryptionKey)),
      secret: decryptText(credential.productionSecretCiphertext, this.encryptionKey),
    };
    const client = this.apiClientFactory(environment);
    const response = await client.renewProductionCsid(productionCredentials, otp, Buffer.from(csrPem, "utf8").toString("base64"), acceptLanguage);
    const certificatePem = toPem(response.binarySecurityToken, "CERTIFICATE");
    await this.prisma.egsCredential.update({
      where: { egsUnitId },
      data: {
        csr: csrPem,
        productionCsidCiphertext: toBytesColumn(encryptText(certificatePem, this.encryptionKey)),
        productionSecretCiphertext: toBytesColumn(encryptText(response.secret, this.encryptionKey)),
        certificateExpiresAt: certificateNotAfter(certificatePem),
        lastRenewalAt: new Date(),
      },
    });
  }

  private async loadCredential(egsUnitId: string) {
    const credential = await this.prisma.egsCredential.findUnique({ where: { egsUnitId } });
    if (!credential) throw new OnboardingError("NOT_FOUND", `No EgsCredential for EGS unit ${egsUnitId} — call startOnboarding first.`);
    return credential;
  }
}

function certificateNotAfter(certificatePem: string): Date {
  return new Date(new X509Certificate(certificatePem).validTo);
}

// Current @types/node parameterizes `Buffer` over `ArrayBufferLike` (which includes
// `SharedArrayBuffer`), while Prisma's generated Bytes-column type expects `Uint8Array<ArrayBuffer>`
// specifically — a purely nominal mismatch: every Buffer this file produces comes from
// encryptText/Buffer.concat, which never backs onto a SharedArrayBuffer. Safe to cast, not safe
// to silently widen (hence a named helper, not a bare `as unknown as` at each call site).
function toBytesColumn(value: Buffer): Uint8Array<ArrayBuffer> {
  return value as unknown as Uint8Array<ArrayBuffer>;
}

// ZATCA's Basic auth "username" is the raw base64 certificate body (the same value
// `binarySecurityToken` carried in the onboarding response) — not the PEM-armored form stored
// in EgsCredential, which exists for X509Certificate parsing and PCKS#10/XAdES use elsewhere.
function certificateBodyBase64(certificatePem: string): string {
  return certificatePem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s/g, "");
}
