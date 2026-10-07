import { Module } from "@nestjs/common";
import {
  AccountMappingService,
  ApprovalPolicyService,
  ApprovalService,
  GoodsReceiptService,
  PrismaAccountingEngine,
  PrismaNumberingService,
  PurchaseOrderService,
  PurchaseReceiptService,
  PurchaseRequestService,
  SupplierInvoiceService,
  TaxCodeService,
  type IAccountingEngine,
  type IAuditLogger,
} from "@erp/core";
import { AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { PURCHASING_ENGINE, PURCHASING_NUMBERING } from "./purchasing.tokens.js";
import { InvoicingController } from "./invoicing.controller.js";
import { PurchasingController } from "./purchasing.controller.js";

// Same shape as InventoryModule: stateless core services over PrismaService, with a module-local
// accounting engine so the receiving path does not depend on another module's providers.
@Module({
  controllers: [PurchasingController, InvoicingController],
  providers: [
    { provide: PURCHASING_NUMBERING, useFactory: () => new PrismaNumberingService() },
    {
      provide: PURCHASING_ENGINE,
      useFactory: (prisma: PrismaService, numbering: PrismaNumberingService) => new PrismaAccountingEngine(prisma, numbering),
      inject: [PrismaService, PURCHASING_NUMBERING],
    },
    { provide: ApprovalService, useFactory: () => new ApprovalService() },
    {
      provide: ApprovalPolicyService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new ApprovalPolicyService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: PurchaseRequestService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new PurchaseRequestService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: PurchaseOrderService,
      useFactory: (prisma: PrismaService, approvals: ApprovalService, audit: IAuditLogger) =>
        new PurchaseOrderService(prisma, approvals, audit),
      inject: [PrismaService, ApprovalService, AUDIT_LOGGER],
    },
    {
      provide: PurchaseReceiptService,
      useFactory: (prisma: PrismaService, engine: IAccountingEngine, audit: IAuditLogger) => {
        // The receipt posts Inventory / GRNI through the same mapping as a direct M4 receipt.
        const mappings = new AccountMappingService(prisma, audit);
        return new PurchaseReceiptService(prisma, new GoodsReceiptService(prisma, engine, mappings, audit), audit);
      },
      inject: [PrismaService, PURCHASING_ENGINE, AUDIT_LOGGER],
    },
    {
      provide: TaxCodeService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new TaxCodeService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: SupplierInvoiceService,
      useFactory: (prisma: PrismaService, engine: IAccountingEngine, audit: IAuditLogger) =>
        new SupplierInvoiceService(prisma, engine, new AccountMappingService(prisma, audit), audit),
      inject: [PrismaService, PURCHASING_ENGINE, AUDIT_LOGGER],
    },
  ],
})
export class PurchasingModule {}
