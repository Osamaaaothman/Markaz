// The missing half of the ZATCA submission seam: turns a posted SalesInvoice (plus its company,
// customer, tax codes, items and EGS credential) into the `SubmitInvoiceParams` that
// @erp/compliance-zatca-sa's InvoiceSubmissionService consumes.
//
// Why this lives in apps/api, not in the pack: the pack deliberately has no dependency on
// @erp/core or the sales module (docs/06-COMPLIANCE-PACK-RULES.md §1,
// docs/02-ARCHITECTURE-RULES.md §1) — it accepts the mapped input (`buildInvoiceInput`) instead of
// reading our tables itself. This file is the composition layer that is allowed to read them, the
// same placement rule compliance-admin.service.ts follows.
//
// Never logs or returns key material (docs/09-SECURITY-RULES.md §5). Everything decrypted here is
// passed straight into the submission service and never travels in a job payload.
import { Prisma, type PrismaClient } from "@erp/db";
import {
  decryptText,
  type SubmitInvoiceParams,
  type ZatcaCredentials,
  type ZatcaDocumentType,
  type ZatcaEnvironment,
  type ZatcaInvoiceInput,
  type ZatcaInvoiceLineInput,
  type ZatcaInvoiceSubtype,
  type ZatcaParty,
  type ZatcaTaxCategoryId,
} from "@erp/compliance-zatca-sa";
import type { ZatcaSubmissionJobData, ZatcaSubmissionParamsLoader } from "./zatca-submission.job.js";

// Our own tax treatment -> the UNCL5305 category id ZATCA's tax category element carries.
const TAX_CATEGORY_BY_TREATMENT: Record<string, ZatcaTaxCategoryId> = {
  STANDARD: "S",
  ZERO_RATED: "Z",
  EXEMPT: "E",
  OUT_OF_SCOPE: "O",
};

const DEFAULT_PAYMENT_MEANS_CODE = "42";

// Exactly the columns this mapper reads: one query per submission, nothing selected that is not
// mapped below (the credential ciphertexts are the only sensitive columns selected, and they are
// decrypted in memory only).
const INVOICE_SELECT = {
  id: true,
  companyId: true,
  documentType: true,
  number: true,
  invoiceDate: true,
  paymentMeansCode: true,
  currency: true,
  totalNet: true,
  totalTax: true,
  totalGross: true,
  originalInvoiceId: true,
  notes: true,
  egsUnitId: true,
  lines: {
    orderBy: { lineNumber: "asc" },
    select: {
      id: true,
      lineNumber: true,
      description: true,
      quantity: true,
      unitPrice: true,
      netAmount: true,
      taxAmount: true,
      taxCodeId: true,
      itemId: true,
      taxCode: { select: { treatment: true, rate: true, exemptionReasonCode: true, exemptionReason: true } },
      item: { select: { unitCode: true } },
    },
  },
  customer: {
    select: {
      name: true,
      nameAr: true,
      vatNumber: true,
      // Party calls it `commercialRegistration`; it is the CR number the ZATCA scheme "CRN" carries.
      commercialRegistration: true,
      streetName: true,
      additionalStreetName: true,
      buildingNumber: true,
      additionalNumber: true,
      district: true,
      city: true,
      postalCode: true,
      countryCode: true,
    },
  },
  company: {
    select: {
      name: true,
      nameAr: true,
      vatNumber: true,
      crNumber: true,
      crNumberScheme: true,
      streetName: true,
      additionalStreetName: true,
      buildingNumber: true,
      district: true,
      city: true,
      postalCode: true,
      countryCode: true,
    },
  },
  egsUnit: {
    select: {
      id: true,
      environment: true,
      status: true,
      credential: {
        select: {
          privateKeyCiphertext: true,
          complianceCsidCiphertext: true,
          complianceSecretCiphertext: true,
          productionCsidCiphertext: true,
          productionSecretCiphertext: true,
        },
      },
    },
  },
} satisfies Prisma.SalesInvoiceSelect;

type InvoiceForZatca = Prisma.SalesInvoiceGetPayload<{ select: typeof INVOICE_SELECT }>;
type PartyRow = InvoiceForZatca["customer"];

// ZATCA's Basic auth "username" is the raw base64 certificate body — the same value
// onboarding.service.ts builds with its own identical (private) helper before every API call.
function certificateBodyBase64(certificatePem: string): string {
  return certificatePem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s/g, "");
}

function sellerParty(company: InvoiceForZatca["company"]): ZatcaParty {
  return {
    partyIdentification: company.crNumber ? { schemeId: company.crNumberScheme ?? "CRN", id: company.crNumber } : undefined,
    address: {
      streetName: company.streetName ?? "",
      additionalStreetName: company.additionalStreetName ?? undefined,
      buildingNumber: company.buildingNumber ?? undefined,
      citySubdivisionName: company.district ?? "",
      cityName: company.city ?? "",
      postalZone: company.postalCode ?? "",
      countryCode: company.countryCode ?? "SA",
    },
    vatNumber: company.vatNumber ?? undefined,
    registrationName: company.name,
  };
}

function buyerParty(customer: PartyRow): ZatcaParty {
  return {
    partyIdentification: customer.commercialRegistration
      ? { schemeId: "CRN", id: customer.commercialRegistration }
      : undefined,
    address: {
      streetName: customer.streetName ?? "",
      additionalStreetName: customer.additionalStreetName ?? undefined,
      buildingNumber: customer.buildingNumber ?? undefined,
      citySubdivisionName: customer.district ?? "",
      cityName: customer.city ?? "",
      postalZone: customer.postalCode ?? "",
      countryCode: customer.countryCode ?? "SA",
    },
    vatNumber: customer.vatNumber ?? undefined,
    registrationName: customer.name,
  };
}

export class ZatcaInvoiceMapper implements ZatcaSubmissionParamsLoader {
  constructor(
    private readonly prisma: PrismaClient,
    // The envelope-encryption key the credential columns were sealed with (key-encryption.ts).
    // Held in memory only, never logged, never put on a job payload (docs/09 §5).
    private readonly encryptionKey: Buffer,
  ) {}

  async load(data: ZatcaSubmissionJobData): Promise<SubmitInvoiceParams> {
    const { salesInvoiceId, egsUnitId, companyId } = jobIds(data);

    const invoice = await this.prisma.salesInvoice.findFirstOrThrow({
      where: {
        id: salesInvoiceId,
        egsUnitId,
        // Present on every outbox-relayed job; a resubmit enqueued from the compliance screen may
        // omit it (the EGS unit already pins the company), so it is only applied when known.
        ...(companyId !== undefined ? { companyId } : {}),
      },
      select: INVOICE_SELECT,
    });

    const egsUnit = invoice.egsUnit;
    if (!egsUnit) throw new Error("Sales invoice is not linked to an EGS unit — it cannot be submitted to ZATCA");
    if (egsUnit.status !== "ACTIVE") {
      throw new Error("EGS unit is not ACTIVE — onboarding must be completed before invoices can be submitted");
    }

    const credential = egsUnit.credential;
    if (!credential) throw new Error("EGS credential ciphertext missing");
    const environment = egsUnit.environment as ZatcaEnvironment;
    const isProduction = environment === "production";
    // Onboarding stores the certificate itself (PEM) in the CSID column, encrypted — there is no
    // plaintext certificate column and none is needed.
    const csidCiphertext = isProduction ? credential.productionCsidCiphertext : credential.complianceCsidCiphertext;
    const secretCiphertext = isProduction ? credential.productionSecretCiphertext : credential.complianceSecretCiphertext;
    if (!credential.privateKeyCiphertext || !csidCiphertext || !secretCiphertext) {
      throw new Error("EGS credential ciphertext missing");
    }

    const certificatePem = decryptText(csidCiphertext, this.encryptionKey);
    const privateKeyPem = decryptText(credential.privateKeyCiphertext, this.encryptionKey);
    const credentials: ZatcaCredentials = {
      binarySecurityToken: certificateBodyBase64(certificatePem),
      secret: decryptText(secretCiphertext, this.encryptionKey),
    };

    const subtype: ZatcaInvoiceSubtype = invoice.customer.vatNumber ? "STANDARD" : "SIMPLIFIED";
    const documentType = invoice.documentType as ZatcaDocumentType;
    const originalInvoice = invoice.originalInvoiceId
      ? await this.prisma.salesInvoice.findUnique({ where: { id: invoice.originalInvoiceId }, select: { number: true } })
      : null;

    const seller = sellerParty(invoice.company);
    const customer = subtype === "STANDARD" ? buyerParty(invoice.customer) : undefined;
    const lines = invoice.lines.map(toLine);
    const paymentMeansCode = invoice.paymentMeansCode || DEFAULT_PAYMENT_MEANS_CODE;

    // A credit/debit note must name the invoice it corrects and carry a reason (the XML builder
    // rejects one without an InstructionNote), so an invoice with no notes falls back to the
    // reference itself rather than failing every such submission locally.
    const billingReference =
      documentType !== "INVOICE" && originalInvoice ? { invoiceId: originalInvoice.number } : undefined;
    const instructionNote =
      documentType === "INVOICE"
        ? undefined
        : invoice.notes ??
          `${documentType === "CREDIT_NOTE" ? "Credit note" : "Debit note"} against ${originalInvoice?.number ?? "the original invoice"}`;

    return {
      companyId: invoice.companyId,
      egsUnitId: egsUnit.id,
      salesInvoiceId: invoice.id,
      environment,
      credentials,
      certificatePem,
      privateKeyPem,
      isSimplified: subtype === "SIMPLIFIED",
      signingTime: invoice.invoiceDate.toISOString(),
      acceptLanguage: "ar",
      qr: {
        sellerName: invoice.company.name,
        vatNumber: invoice.company.vatNumber ?? "",
        timestamp: invoice.invoiceDate.toISOString(),
        invoiceTotalWithVat: invoice.totalGross.toFixed(2),
        vatTotal: invoice.totalTax.toFixed(2),
      },
      buildInvoiceInput: (chain: { icv: bigint; previousInvoiceHash: string }): ZatcaInvoiceInput => ({
        subtype,
        documentType,
        id: invoice.number,
        // Our SalesInvoice id is itself a UUID and, unlike a freshly generated one, is stable across
        // a retry of the same submission (the hash chain must not move under a retry).
        uuid: invoice.id,
        issueDate: invoice.invoiceDate.toISOString().slice(0, 10),
        issueTime: invoice.invoiceDate.toISOString().slice(11, 19),
        currency: invoice.currency,
        icv: chain.icv.toString(),
        previousInvoiceHash: chain.previousInvoiceHash,
        billingReference,
        instructionNote,
        supplier: seller,
        customer,
        paymentMeansCode,
        lines,
      }),
    };
  }
}

function toLine(line: InvoiceForZatca["lines"][number]): ZatcaInvoiceLineInput {
  const taxCategoryId = TAX_CATEGORY_BY_TREATMENT[line.taxCode.treatment];
  if (!taxCategoryId) throw new Error(`Unknown tax treatment "${line.taxCode.treatment}" on line ${line.lineNumber}`);
  return {
    id: String(line.lineNumber),
    quantity: line.quantity.toString(),
    unitCode: line.item?.unitCode ?? "PCE",
    lineExtensionAmount: line.netAmount.toFixed(2),
    taxAmount: line.taxAmount.toFixed(2),
    itemName: line.description,
    taxCategoryId,
    taxPercent: line.taxCode.rate.toFixed(2),
    exemptionReasonCode: line.taxCode.exemptionReasonCode ?? undefined,
    exemptionReason: line.taxCode.exemptionReason ?? undefined,
    priceAmount: line.unitPrice.toFixed(2),
  };
}

// A job reaches this loader in one of two shapes: enqueued directly (the resubmitter puts
// salesInvoiceId/egsUnitId on the job data) or relayed from the outbox, where
// apps/api/src/jobs/outbox-relay.ts nests the written payload under `payload`. Both are accepted so
// an invoice issued normally (outbox) and one resubmitted by hand take the same path.
function jobIds(data: ZatcaSubmissionJobData): { salesInvoiceId: string; egsUnitId: string; companyId: string | undefined } {
  const nested = (data as unknown as { readonly payload?: { readonly salesInvoiceId?: string; readonly egsUnitId?: string } }).payload;
  const salesInvoiceId = data.salesInvoiceId ?? nested?.salesInvoiceId;
  const egsUnitId = data.egsUnitId ?? nested?.egsUnitId;
  if (!salesInvoiceId || !egsUnitId) {
    throw new Error("ZATCA submission job is missing salesInvoiceId and/or egsUnitId — cannot load the invoice");
  }
  return { salesInvoiceId, egsUnitId, companyId: data.companyId };
}
