import { Injectable } from "@nestjs/common";
import { AttachmentService, SalesInvoiceService } from "@erp/core";
import { CompanyDocumentService } from "../documents/company-document.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { SupportedDocumentLanguage } from "../i18n/server-i18n.js";
import { ComplianceAdminService } from "../compliance/compliance-admin.service.js";
import { localizedCompanyName } from "../common/company-name.js";
import { salesInvoiceToPdfHtml } from "./exports/sales-invoice-export.js";

export interface RenderedInvoicePdf {
  readonly bytes: Buffer;
  readonly fileName: string;
}

// The printable copy of a posted invoice / credit / debit note. One builder for every channel
// that hands the document out (the PDF endpoint, the chat bots), so the copy a customer receives
// never depends on how it was requested. Throws the same errors as SalesInvoiceService.get.
@Injectable()
export class SalesInvoicePdfService {
  constructor(
    private readonly documents: CompanyDocumentService,
    private readonly invoices: SalesInvoiceService,
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentService,
    private readonly compliance: ComplianceAdminService,
  ) {}

  async render(companyId: string, id: string, language: SupportedDocumentLanguage): Promise<RenderedInvoicePdf> {
    const invoice = await this.invoices.get(companyId, id);
    const issued = await this.prisma.salesInvoice.findFirstOrThrow({ where: { id, companyId }, select: { actorId: true, createdAt: true } });
    const issuer = await this.prisma.user.findFirst({ where: { id: issued.actorId, companyId }, select: { email: true } });
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        name: true,
        nameAr: true,
        vatNumber: true,
        crNumber: true,
        streetName: true,
        additionalStreetName: true,
        buildingNumber: true,
        additionalNumber: true,
        district: true,
        city: true,
        postalCode: true,
        phone: true,
      },
    });
    // The company logo, embedded as a data URI so the PDF never fetches anything. No logo is not an error.
    const logo = await this.attachments.getCompanyLogo(companyId).catch(() => null);
    const logoDataUri = logo ? `data:${logo.contentType};base64,${Buffer.from(logo.bytes).toString("base64")}` : undefined;
    const addressSeparator = language === "ar" ? "، " : ", ";
    const sellerBuildingPart = [company.buildingNumber, company.additionalNumber].filter((p): p is string => Boolean(p?.trim())).join("-");
    const sellerAddressParts = [company.streetName, company.additionalStreetName, company.district, company.city, company.postalCode].filter(
      (p): p is string => Boolean(p?.trim()),
    );
    const sellerAddress = [sellerBuildingPart, ...sellerAddressParts].filter(Boolean).join(addressSeparator).trim() || null;
    const bytes = await this.documents.render(
      companyId,
      language,
      await salesInvoiceToPdfHtml({
        invoice,
        compliance: await this.compliance.invoicePrintData(companyId, id),
        issuedBy: issuer?.email ?? null,
        issuedAt: issued.createdAt.toISOString(),
        language,
        companyName: localizedCompanyName(company, language),
        logoDataUri,
        sellerVatNumber: company.vatNumber,
        sellerCrNumber: company.crNumber,
        sellerAddress,
        sellerPhone: company.phone,
      }),
    );
    return { bytes, fileName: `${invoice.number}.pdf` };
  }
}
