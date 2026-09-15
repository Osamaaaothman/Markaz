import { Module } from "@nestjs/common";
import {
  BalanceSheetService,
  IncomeStatementService,
  PrismaAccountingEngine,
  PrismaNumberingService,
  TrialBalanceService,
} from "@erp/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingController } from "./accounting.controller.js";
import { AccountingExportService } from "./accounting-export.service.js";
import { ACCOUNTING_ENGINE, NUMBERING_SERVICE } from "./accounting.tokens.js";

@Module({
  controllers: [AccountingController],
  providers: [
    { provide: NUMBERING_SERVICE, useFactory: () => new PrismaNumberingService() },
    {
      provide: ACCOUNTING_ENGINE,
      useFactory: (prisma: PrismaService, numbering: PrismaNumberingService) =>
        new PrismaAccountingEngine(prisma, numbering),
      inject: [PrismaService, NUMBERING_SERVICE],
    },
    {
      provide: TrialBalanceService,
      useFactory: (prisma: PrismaService) => new TrialBalanceService(prisma),
      inject: [PrismaService],
    },
    {
      provide: BalanceSheetService,
      useFactory: (prisma: PrismaService) => new BalanceSheetService(prisma),
      inject: [PrismaService],
    },
    {
      provide: IncomeStatementService,
      useFactory: (prisma: PrismaService) => new IncomeStatementService(prisma),
      inject: [PrismaService],
    },
    AccountingExportService,
  ],
})
export class AccountingModule {}
