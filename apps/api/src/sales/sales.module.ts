import { Module } from "@nestjs/common";
import {
  AccountMappingService,
  PrismaAccountingEngine,
  PrismaNumberingService,
  QuotationService,
  SalesInvoiceService,
  SalesOrderService,
  type IAccountingEngine,
  type IAuditLogger,
} from "@erp/core";
import { AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SALES_ENGINE, SALES_NUMBERING } from "./sales.tokens.js";
import { SalesController } from "./sales.controller.js";

// Same shape as the inventory and purchasing modules: stateless core services over PrismaService and
// a module-local accounting engine.
@Module({
  controllers: [SalesController],
  providers: [
    { provide: SALES_NUMBERING, useFactory: () => new PrismaNumberingService() },
    {
      provide: SALES_ENGINE,
      useFactory: (prisma: PrismaService, numbering: PrismaNumberingService) => new PrismaAccountingEngine(prisma, numbering),
      inject: [PrismaService, SALES_NUMBERING],
    },
    {
      provide: QuotationService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new QuotationService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: SalesOrderService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new SalesOrderService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: SalesInvoiceService,
      useFactory: (prisma: PrismaService, engine: IAccountingEngine, audit: IAuditLogger) =>
        new SalesInvoiceService(prisma, engine, new AccountMappingService(prisma, audit), audit),
      inject: [PrismaService, SALES_ENGINE, AUDIT_LOGGER],
    },
  ],
})
export class SalesModule {}
