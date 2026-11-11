import { Module } from "@nestjs/common";
import {
  DocumentDraftService,
  DocumentTrailService,
  type IPermissionService,
  type IAuditLogger,
} from "@erp/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { PERMISSION_SERVICE, AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { DocumentDraftsController } from "./document-drafts.controller.js";
import { DocumentTrailController } from "./document-trail.controller.js";

@Module({
  controllers: [DocumentDraftsController, DocumentTrailController],
  providers: [
    {
      provide: DocumentDraftService,
      useFactory: (prisma: PrismaService, permissions: IPermissionService, audit: IAuditLogger) =>
        new DocumentDraftService(prisma, permissions, audit),
      inject: [PrismaService, PERMISSION_SERVICE, AUDIT_LOGGER],
    },
    {
      provide: DocumentTrailService,
      useFactory: (prisma: PrismaService, permissions: IPermissionService) =>
        new DocumentTrailService(prisma, permissions),
      inject: [PrismaService, PERMISSION_SERVICE],
    },
  ],
})
export class DocumentsModule {}
