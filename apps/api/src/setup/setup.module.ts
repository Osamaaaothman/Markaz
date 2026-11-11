import { Module } from "@nestjs/common";
import { AccountMappingService, ChartOfAccountsService, MappingSuggestionService, SetupStatusService, type IAuditLogger } from "@erp/core";
import { AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SetupController } from "./setup.controller.js";
import { CompanySettingsService } from "@erp/core";
import { CompanySettingsController } from "./company-settings.controller.js";

@Module({
  controllers: [SetupController, CompanySettingsController],
  providers: [
    { provide: CompanySettingsService, useFactory: (prisma: PrismaService, audit: IAuditLogger) => new CompanySettingsService(prisma, audit), inject: [PrismaService, AUDIT_LOGGER] },
    { provide: SetupStatusService, useFactory: (prisma: PrismaService) => new SetupStatusService(prisma), inject: [PrismaService] },
    {
      provide: MappingSuggestionService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new MappingSuggestionService(prisma, new AccountMappingService(prisma, audit), new ChartOfAccountsService(prisma, audit)),
      inject: [PrismaService, AUDIT_LOGGER],
    },
  ],
})
export class SetupModule {}
