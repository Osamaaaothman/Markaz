import { SalesInvoiceIssueError, type SalesInvoiceIssueValidator } from "@erp/core";
import { invoiceIssueProblems } from "@erp/compliance-zatca-sa";
import { buyerParty, sellerParty } from "./zatca-invoice-mapper.js";

/** Composition-only adapter: validate the same fields the submission mapper will emit. */
export class SalesInvoiceIssueGuard {
  readonly validate: SalesInvoiceIssueValidator = async (tx, input) => {
    if (!input.egsUnitId) return;
    const unit = await tx.egsUnit.findFirst({
      where: { id: input.egsUnitId, companyId: input.companyId, isActive: true },
      select: { status: true },
    });
    if (unit?.status !== "ACTIVE") throw new SalesInvoiceIssueError("COMPLIANCE_UNIT_NOT_READY");
    const seller = await tx.company.findFirstOrThrow({
      where: { id: input.companyId },
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
    });
    const buyer = await tx.party.findFirstOrThrow({
      where: { id: input.customerId, companyId: input.companyId },
      select: {
        name: true,
        nameAr: true,
        vatNumber: true,
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
    });
    const problems = invoiceIssueProblems({
      documentType: input.documentType,
      supplier: sellerParty(seller),
      customer: buyer.vatNumber ? buyerParty(buyer) : undefined,
      actualDeliveryDate: input.actualDeliveryDate?.toISOString().slice(0, 10),
    });
    if (problems[0]) throw new SalesInvoiceIssueError(problems[0]);
  };
}
