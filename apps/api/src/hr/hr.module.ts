import { Module } from "@nestjs/common";
import {
  AccountMappingService,
  EmployeeService,
  EndOfServiceService,
  PayrollRunService,
  PrismaAccountingEngine,
  PrismaNumberingService,
  SalaryAdvanceService,
  type IAccountingEngine,
  type IAuditLogger,
} from "@erp/core";
import { AttachmentsModule } from "../attachments/attachments.module.js";
import { AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { HrController } from "./hr.controller.js";
import { HR_ENGINE, HR_NUMBERING } from "./hr.tokens.js";

// Same shape as PurchasingModule: stateless core services over PrismaService, with a module-local
// accounting engine. Imports AttachmentsModule for the company logo on the payslip PDF, the same
// way SalesModule does for the sales invoice PDF.
@Module({
  imports: [AttachmentsModule],
  controllers: [HrController],
  providers: [
    { provide: HR_NUMBERING, useFactory: () => new PrismaNumberingService() },
    {
      provide: HR_ENGINE,
      useFactory: (prisma: PrismaService, numbering: PrismaNumberingService) => new PrismaAccountingEngine(prisma, numbering),
      inject: [PrismaService, HR_NUMBERING],
    },
    {
      provide: EmployeeService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new EmployeeService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: PayrollRunService,
      useFactory: (prisma: PrismaService, engine: IAccountingEngine, audit: IAuditLogger) =>
        new PayrollRunService(prisma, engine, new AccountMappingService(prisma, audit), audit),
      inject: [PrismaService, HR_ENGINE, AUDIT_LOGGER],
    },
    {
      provide: SalaryAdvanceService,
      useFactory: (prisma: PrismaService, engine: IAccountingEngine, audit: IAuditLogger) =>
        new SalaryAdvanceService(prisma, engine, new AccountMappingService(prisma, audit), audit),
      inject: [PrismaService, HR_ENGINE, AUDIT_LOGGER],
    },
    {
      provide: EndOfServiceService,
      useFactory: (prisma: PrismaService, engine: IAccountingEngine, audit: IAuditLogger) =>
        new EndOfServiceService(prisma, engine, new AccountMappingService(prisma, audit), audit),
      inject: [PrismaService, HR_ENGINE, AUDIT_LOGGER],
    },
  ],
})
export class HrModule {}
