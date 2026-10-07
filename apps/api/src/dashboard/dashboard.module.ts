import { Module } from "@nestjs/common";
import { AccountMappingService, AgingService, DashboardService, type IAuditLogger } from "@erp/core";
import { AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { DashboardController } from "./dashboard.controller.js";

@Module({
  controllers: [DashboardController],
  providers: [
    {
      provide: DashboardService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new DashboardService(prisma, new AgingService(prisma, new AccountMappingService(prisma, audit))),
      inject: [PrismaService, AUDIT_LOGGER],
    },
  ],
})
export class DashboardModule {}
