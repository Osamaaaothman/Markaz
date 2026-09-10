import { Module } from "@nestjs/common";
import { PrismaAccountingEngine, PrismaNumberingService, TrialBalanceService } from "@erp/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingController } from "./accounting.controller.js";
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
  ],
})
export class AccountingModule {}
