// Orchestrates one invoice's submission: assigns its place in the EGS's ICV/PIH chain, builds
// and signs its XML, calls ZATCA, and persists the outcome. Deliberately does NOT know how to
// turn a SalesInvoice into a ZatcaInvoiceInput — the caller supplies that mapping (`buildInvoiceInput`)
// so this service stays usable from a test or a real job without depending on packages/core/sales
// (docs/02-ARCHITECTURE-RULES.md §1 — this package has no dependency on core or any module).
//
// Chain/transaction discipline (docs/06-COMPLIANCE-PACK-RULES.md §4, docs/02 §5 "never call an
// external HTTP service inside a database transaction"): the chain's row lock is held only for
// the instant it takes to read-and-reserve the next ICV/PIH and write a SUBMITTING record — never
// across the network call. This is only safe when at most one `submit()` runs per EGS unit at a
// time (the task's own suggested alternative to holding the lock across the call: "a per-EGS
// BullMQ queue with concurrency 1" — the caller, not this service, is responsible for that
// serialization; apps/api's job wiring gives each EGS its own single-concurrency worker).
import { newId } from "@erp/shared";
import type { PrismaClient, Prisma } from "@erp/db";
import { buildBareInvoiceXml } from "../xml/invoice-xml-builder.js";
import type { ZatcaInvoiceInput } from "../xml/invoice-xml.types.js";
import { signInvoiceXml, type SignedInvoice } from "../xml/xades-signature.js";
import type { QrFields } from "../xml/qr.js";
import { EgsChainError, EgsChainService } from "../egs-chain.service.js";
import { checkInvoiceConsistency } from "../validation/invoice-consistency.js";
import { verifySignedInvoice, stripSignatureElements } from "../validation/signed-invoice-verifier.js";
import { hashInvoiceXml } from "../xml/invoice-hash.js";
import { invoiceQrArtifact, readInvoiceArtifacts } from "../xml/invoice-artifacts.js";
import type { ValidationReport } from "../validation/validation-report.js";
import { ZatcaApiClient, type ClearanceRequestBody, type ZatcaCredentials } from "./zatca-api-client.js";
import { classifyClearanceResponse, classifyError, classifyReportingResponse, type SubmissionOutcome } from "./submission-outcome.js";
import type { ZatcaEnvironment } from "./zatca-environment.js";

export class AlreadySubmittedError extends Error {
  constructor(readonly salesInvoiceId: string) {
    super(`Sales invoice ${salesInvoiceId} already has a definitive ZATCA outcome — a correction must be a new document, not a resubmission.`);
    this.name = "AlreadySubmittedError";
  }
}

// Our own pre-flight checks (validation/) found a problem, so nothing was sent to ZATCA. The chain
// position stays reserved and unconsumed on the record: fix the cause and submit the same invoice
// again, and it reuses that position. Retrying without a fix cannot succeed, so a job wrapper
// should not retry this blindly.
export class InvoiceValidationError extends Error {
  constructor(
    readonly salesInvoiceId: string,
    readonly stage: "BEFORE_SIGNING" | "AFTER_SIGNING",
    readonly messages: readonly string[],
  ) {
    super(`Sales invoice ${salesInvoiceId} failed local validation ${stage === "BEFORE_SIGNING" ? "before signing" : "after signing"}: ${messages.join("; ")}`);
    this.name = "InvoiceValidationError";
  }
}

type RecordStatus = "SUBMITTING" | "CLEARED" | "REPORTED" | "ACCEPTED_WITH_WARNINGS" | "REJECTED" | "FAILED_RETRYABLE";

const DEFINITIVE_STATUSES: readonly RecordStatus[] = ["CLEARED", "REPORTED", "ACCEPTED_WITH_WARNINGS", "REJECTED"];

function statusFor(outcome: SubmissionOutcome["complianceOutcome"]): RecordStatus {
  switch (outcome.kind) {
    case "CLEARED":
      return "CLEARED";
    case "REPORTED":
      return "REPORTED";
    case "ACCEPTED_WITH_WARNINGS":
      return "ACCEPTED_WITH_WARNINGS";
    case "REJECTED":
      return "REJECTED";
    case "PENDING_RETRY":
    case "PACK_UNAVAILABLE":
      return "FAILED_RETRYABLE";
  }
}

export interface SubmitInvoiceParams {
  readonly companyId: string;
  readonly egsUnitId: string;
  readonly salesInvoiceId: string;
  readonly environment: ZatcaEnvironment;
  readonly credentials: ZatcaCredentials;
  readonly certificatePem: string;
  readonly privateKeyPem: string;
  readonly isSimplified: boolean;
  readonly signingTime: string;
  readonly acceptLanguage: "ar" | "en";
  readonly qr: Pick<QrFields, "sellerName" | "vatNumber" | "timestamp" | "invoiceTotalWithVat" | "vatTotal">;
  // Everything about the invoice's content except icv/previousInvoiceHash, which only this
  // service may assign — called once the chain position is known (fresh, or resumed on retry).
  readonly buildInvoiceInput: (chain: { icv: bigint; previousInvoiceHash: string }) => ZatcaInvoiceInput;
}

export interface SubmitInvoiceResult {
  readonly zatcaInvoiceRecordId: string;
  readonly outcome: SubmissionOutcome;
}

export class InvoiceSubmissionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chain: EgsChainService = new EgsChainService(),
    private readonly apiClientFactory: (environment: ZatcaEnvironment) => ZatcaApiClient = (environment) => new ZatcaApiClient(environment),
  ) {}

  async submit(params: SubmitInvoiceParams): Promise<SubmitInvoiceResult> {
    const startedAt = new Date();
    const { recordId, icv, previousInvoiceHash, uuid, signedXml } = await this.reserveChainPosition(params);
    let signed: Pick<SignedInvoice, "signedXml" | "invoiceHash" | "qrBase64">;
    let invoiceUuid = uuid;
    let isSimplified = params.isSimplified;
    try {
      if (signedXml) {
        // A timeout can mean ZATCA accepted the request. Retry the exact bytes, even after renewal.
        const stored = readInvoiceArtifacts(signedXml);
        invoiceUuid = stored.uuid;
        isSimplified = stored.simplified;
        signed = { signedXml, invoiceHash: hashInvoiceXml(stripSignatureElements(signedXml)), qrBase64: stored.qr ?? "" };
      } else {
        const invoiceInput = { ...params.buildInvoiceInput({ icv, previousInvoiceHash }), uuid };
        const bareXml = buildBareInvoiceXml(invoiceInput);
        await this.requireValid(params, recordId, startedAt, "BEFORE_SIGNING", checkInvoiceConsistency(bareXml));
        signed = signInvoiceXml(bareXml, {
          certificatePem: params.certificatePem, privateKeyPem: params.privateKeyPem,
          signingTime: params.signingTime, isSimplified: params.isSimplified, qr: params.qr,
        });
      }
      await this.requireValid(params, recordId, startedAt, "AFTER_SIGNING", verifySignedInvoice(signed.signedXml));
    } catch (error) {
      if (error instanceof InvoiceValidationError) throw error;
      // Store a safe diagnostic, never the signing inputs or cryptographic key material.
      await this.requireValid(params, recordId, startedAt, "BEFORE_SIGNING", {
        valid: false, issues: [{ severity: "error", code: "PREPARATION_FAILED", message: "Invoice signing failed; verify the EGS certificate and invoice configuration" }],
      });
      throw error;
    }
    // Generation, not a successful HTTP response, consumes a chain position. Persist
    // the signed bytes and advance atomically; retries keep the original position.
    await this.prisma.$transaction(async (tx) => {
      const next = await this.chain.peekNext(tx, params.egsUnitId);
      if (next.icv < icv || (next.icv === icv && next.previousInvoiceHash !== previousInvoiceHash)) {
        throw new EgsChainError("ICV_MISMATCH", "Invoice does not follow the persisted EGS chain");
      }
      await tx.zatcaInvoiceRecord.update({ where: { id: recordId }, data: {
        uuid: invoiceUuid, status: "SUBMITTING", signedXml: signed.signedXml,
        invoiceHash: signed.invoiceHash.zatcaHash, qrCode: isSimplified ? signed.qrBase64 : null, submittedAt: startedAt,
      } });
      if (next.icv === icv) await this.chain.advance(tx, params.egsUnitId, icv, signed.invoiceHash.zatcaHash);
    });
    const submissionParams = { ...params, isSimplified };
    const outcome = await this.callZatca(submissionParams, invoiceUuid, signed);
    await this.finalize(submissionParams, recordId, startedAt, signed, outcome);
    return { zatcaInvoiceRecordId: recordId, outcome };
  }

  // Warnings never block; any error stops the submission, is written onto the record where the UI
  // shows it, and is thrown. `attempts` is not incremented: ZATCA was never called.
  private async requireValid(params: SubmitInvoiceParams, recordId: string, startedAt: Date, stage: InvoiceValidationError["stage"], report: ValidationReport): Promise<void> {
    if (report.valid) return;
    const messages = report.issues.filter((i) => i.severity === "error").map((i) => `${i.code}: ${i.message}`);
    await this.prisma.zatcaInvoiceRecord.update({ where: { id: recordId }, data: {
      status: "FAILED_RETRYABLE", validationErrors: messages,
      history: { create: { id: newId(), companyId: params.companyId, stage, status: "FAILED_RETRYABLE", startedAt, completedAt: new Date(), warnings: [], errors: messages } },
    } });
    throw new InvoiceValidationError(params.salesInvoiceId, stage, messages);
  }

  // Reads any existing record for this invoice first: refuses outright if it already has a
  // definitive outcome (CLEARED/REPORTED/ACCEPTED_WITH_WARNINGS/REJECTED — docs/06 §7, a
  // correction is a new document, never a resubmission under the same UUID/ICV); resumes at the
  // SAME chain position if a previous attempt only got as far as FAILED_RETRYABLE or crashed
  // mid-flight (still SUBMITTING); otherwise reserves a fresh position.
  private async reserveChainPosition(params: SubmitInvoiceParams): Promise<{ recordId: string; icv: bigint; previousInvoiceHash: string; uuid: string; signedXml: string | null }> {
    const existing = await this.prisma.zatcaInvoiceRecord.findUnique({ where: { salesInvoiceId: params.salesInvoiceId } });
    if (existing) {
      if (existing.companyId !== params.companyId || existing.egsUnitId !== params.egsUnitId) throw new Error("Invoice scope mismatch");
      if (DEFINITIVE_STATUSES.includes(existing.status as RecordStatus)) {
        throw new AlreadySubmittedError(params.salesInvoiceId);
      }
      return { recordId: existing.id, icv: existing.icv, previousInvoiceHash: existing.previousInvoiceHash, uuid: existing.uuid, signedXml: existing.signedXml };
    }

    return this.prisma.$transaction(async (tx) => {
      let next = await this.chain.peekNext(tx, params.egsUnitId);
      // Older versions saved signed documents but advanced only after a definitive
      // HTTP outcome. Recover that one reserved tail without changing its evidence.
      const pendingTail = await tx.zatcaInvoiceRecord.findUnique({
        where: { egsUnitId_icv: { egsUnitId: params.egsUnitId, icv: next.icv } },
        select: { companyId: true, salesInvoiceId: true, signedXml: true, invoiceHash: true, previousInvoiceHash: true },
      });
      if (pendingTail && (!pendingTail.signedXml || !pendingTail.invoiceHash)) {
        throw new EgsChainError("CHAIN_BLOCKED", `The EGS chain is reserved by invoice ${pendingTail.salesInvoiceId}; resolve that invoice before generating another one.`);
      }
      if (pendingTail?.signedXml && pendingTail.invoiceHash) {
        if (pendingTail.companyId !== params.companyId || pendingTail.previousInvoiceHash !== next.previousInvoiceHash
          || hashInvoiceXml(stripSignatureElements(pendingTail.signedXml)).zatcaHash !== pendingTail.invoiceHash) {
          throw new EgsChainError("ICV_MISMATCH", "Stored invoice does not match the EGS chain tail");
        }
        await this.chain.advance(tx, params.egsUnitId, next.icv, pendingTail.invoiceHash);
        next = await this.chain.peekNext(tx, params.egsUnitId);
      }
      const recordId = newId();
      await tx.zatcaInvoiceRecord.create({
        data: {
          id: recordId,
          companyId: params.companyId,
          salesInvoiceId: params.salesInvoiceId,
          egsUnitId: params.egsUnitId,
          uuid: params.salesInvoiceId,
          icv: next.icv,
          previousInvoiceHash: next.previousInvoiceHash,
          status: "SUBMITTING",
        },
      });
      return { recordId, icv: next.icv, previousInvoiceHash: next.previousInvoiceHash, uuid: params.salesInvoiceId, signedXml: null };
    });
  }

  private async callZatca(params: SubmitInvoiceParams, uuid: string, signed: Pick<SignedInvoice, "signedXml" | "invoiceHash">): Promise<SubmissionOutcome> {
    const client = this.apiClientFactory(params.environment);
    const body: ClearanceRequestBody = {
      invoiceHash: signed.invoiceHash.xmldsigBase64,
      uuid,
      invoice: Buffer.from(signed.signedXml, "utf8").toString("base64"),
    };
    try {
      if (params.isSimplified) {
        return classifyReportingResponse(await client.reportInvoice(params.credentials, body, params.acceptLanguage));
      }
      return classifyClearanceResponse(await client.clearInvoice(params.credentials, body, params.acceptLanguage));
    } catch (error) {
      return classifyError(error);
    }
  }

  // HTTP outcomes update submission evidence only. The generation chain was already
  // committed before the call and must never rewind when an older invoice is retried.
  private async finalize(params: SubmitInvoiceParams, recordId: string, startedAt: Date, signed: Pick<SignedInvoice, "signedXml" | "invoiceHash" | "qrBase64">, outcome: SubmissionOutcome): Promise<void> {
    const status = statusFor(outcome.complianceOutcome);
    const completedAt = new Date();
    const artifact = invoiceQrArtifact(signed.signedXml, outcome.clearedXml);
    const warnings = [...outcome.warnings];
    if (!params.isSimplified && ["CLEARED", "ACCEPTED_WITH_WARNINGS"].includes(status) && !artifact) {
      warnings.push("CLEARED_QR_UNAVAILABLE: The clearance response did not contain a matching invoice QR. Download the XML and check the response; do not use the pre-clearance QR.");
    }
    const raw = outcome.rawResponse;
    const httpStatus = raw && typeof raw === "object" && "status" in raw && typeof raw.status === "number" ? raw.status : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.zatcaInvoiceRecord.update({
        where: { id: recordId },
        data: {
          status,
          invoiceHash: signed.invoiceHash.zatcaHash,
          signedXml: signed.signedXml,
          clearedXml: outcome.clearedXml,
          qrCode: artifact?.qr ?? null,
          ...(outcome.rawResponse !== undefined ? { lastResponse: outcome.rawResponse as Prisma.InputJsonValue } : {}),
          validationWarnings: warnings,
          validationErrors: outcome.errors,
          attempts: { increment: 1 },
          submittedAt: completedAt,
          ...(["CLEARED", "REPORTED", "ACCEPTED_WITH_WARNINGS"].includes(status)
            ? params.isSimplified ? { reportedAt: completedAt } : { clearedAt: completedAt } : {}),
          history: { create: { id: newId(), companyId: params.companyId, stage: params.isSimplified ? "REPORTING" : "CLEARANCE", status, startedAt, completedAt, warnings, errors: [...outcome.errors], httpStatus } },
        },
      });
    });
  }
}
