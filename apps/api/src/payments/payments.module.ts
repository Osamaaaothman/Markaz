import { Module } from "@nestjs/common";
import {
  AccountMappingService,
  AgingService,
  PartyStatementService,
  PaymentService,
  PrismaAccountingEngine,
  PrismaNumberingService,
  type IAccountingEngine,
  type IAuditLogger,
} from "@erp/core";
import { AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { PaymentsController } from "./payments.controller.js";
import { ReceivablesExportService, ReceivablesReportsController } from "./receivables-reports.controller.js";

const PAYMENTS_NUMBERING = Symbol("INumberingService (payments)");
const PAYMENTS_ENGINE = Symbol("IAccountingEngine (payments)");

// Same shape as the other document modules: a module-local engine over PrismaService.
@Module({
  controllers: [PaymentsController, ReceivablesReportsController],
  providers: [
    { provide: PAYMENTS_NUMBERING, useFactory: () => new PrismaNumberingService() },
    {
      provide: PAYMENTS_ENGINE,
      useFactory: (prisma: PrismaService, numbering: PrismaNumberingService) => new PrismaAccountingEngine(prisma, numbering),
      inject: [PrismaService, PAYMENTS_NUMBERING],
    },
    {
      provide: PaymentService,
      useFactory: (prisma: PrismaService, engine: IAccountingEngine, audit: IAuditLogger) =>
        new PaymentService(prisma, engine, new AccountMappingService(prisma, audit), audit),
      inject: [PrismaService, PAYMENTS_ENGINE, AUDIT_LOGGER],
    },
    {
      provide: AgingService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new AgingService(prisma, new AccountMappingService(prisma, audit)),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    { provide: PartyStatementService, useFactory: (prisma: PrismaService) => new PartyStatementService(prisma), inject: [PrismaService] },
    ReceivablesExportService,
  ],
})
export class PaymentsModule {}
