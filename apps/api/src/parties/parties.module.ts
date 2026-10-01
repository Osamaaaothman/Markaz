import { Module } from "@nestjs/common";
import { PartyService, type IAuditLogger } from "@erp/core";
import { AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { PartiesController } from "./parties.controller.js";

@Module({
  controllers: [PartiesController],
  providers: [
    {
      provide: PartyService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new PartyService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
  ],
})
export class PartiesModule {}
