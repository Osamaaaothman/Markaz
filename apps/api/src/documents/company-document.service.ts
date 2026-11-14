import { Injectable, Logger } from "@nestjs/common";
import { AttachmentService } from "@erp/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../i18n/server-i18n.js";
import { localizedCompanyName } from "../common/company-name.js";
import { renderCompanyLetterhead } from "../accounting/exports/report-document.util.js";
import { renderHtmlToPdf } from "./pdf-renderer.js";
import type { PartyDocumentDetails } from "./party-document-details.js";

/** Company-scoped print assets for reports which do not already load a seller profile. */
@Injectable()
export class CompanyDocumentService {
  private readonly logger = new Logger(CompanyDocumentService.name);
  constructor(private readonly prisma: PrismaService, private readonly attachments: AttachmentService) {}

  async party(companyId: string, id: string): Promise<PartyDocumentDetails | null> {
    return this.prisma.party.findFirst({ where: { id, companyId }, select: {
      vatNumber: true, commercialRegistration: true, phone: true, email: true, streetName: true,
      additionalStreetName: true, buildingNumber: true, additionalNumber: true, district: true,
      city: true, postalCode: true, countryCode: true,
    } });
  }

  async render(companyId: string, language: SupportedDocumentLanguage, html: string, options: { landscape?: boolean } = {}): Promise<Buffer> {
    const [company, logo, t] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: {
        name: true, nameAr: true, vatNumber: true, crNumber: true, phone: true,
        buildingNumber: true, streetName: true, additionalStreetName: true, additionalNumber: true,
        district: true, city: true, postalCode: true, countryCode: true,
      } }),
      this.attachments.getCompanyLogo(companyId).catch(() => {
        this.logger.warn({ companyId, event: "document_logo_unavailable" });
        return null;
      }),
      getDocumentTranslator(language),
    ]);
    const address = [company.buildingNumber, company.streetName, company.additionalStreetName, company.district,
      company.city, company.postalCode, company.additionalNumber, company.countryCode].filter(Boolean).join(language === "ar" ? "، " : ", ");
    const letterheadHtml = renderCompanyLetterhead({
      companyName: localizedCompanyName(company, language),
      ...(logo ? { logoDataUri: `data:${logo.contentType};base64,${Buffer.from(logo.bytes).toString("base64")}` } : {}),
      sellerDetailLines: [
        ...(company.vatNumber ? [`${t("seller.vatNumber")}: ${company.vatNumber}`] : []),
        ...(company.crNumber ? [`${t("seller.crNumber")}: ${company.crNumber}`] : []),
        ...(address ? [address] : []),
        ...(company.phone ? [`${t("seller.phone")}: ${company.phone}`] : []),
      ],
    });
    return renderHtmlToPdf(html, { ...options, letterheadHtml });
  }
}
