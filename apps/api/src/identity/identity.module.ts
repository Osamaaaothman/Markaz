import { Global, Module } from "@nestjs/common";
import { PrismaAuditLogger, PrismaPermissionService } from "@erp/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { AUDIT_LOGGER, PERMISSION_SERVICE } from "./identity.tokens.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Global()
@Module({
  controllers: [UsersController],
  providers: [
    {
      provide: PERMISSION_SERVICE,
      useFactory: (prisma: PrismaService) => new PrismaPermissionService(prisma),
      inject: [PrismaService],
    },
    {
      provide: AUDIT_LOGGER,
      useFactory: (prisma: PrismaService) => new PrismaAuditLogger(prisma),
      inject: [PrismaService],
    },
    UsersService,
  ],
  exports: [PERMISSION_SERVICE, AUDIT_LOGGER],
})
export class IdentityModule {}
