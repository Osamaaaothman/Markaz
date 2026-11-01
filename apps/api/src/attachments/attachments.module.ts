import { Module } from "@nestjs/common";
import {
  AttachmentService,
  CloudinaryFileStorage,
  LocalFileStorage,
  type IAuditLogger,
  type IFileStorage,
  type IPermissionService,
} from "@erp/core";
import { AUDIT_LOGGER, PERMISSION_SERVICE } from "../identity/identity.tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { parseAttachmentConfig } from "./attachments.config.js";
import { AttachmentsController, PicturesController } from "./attachments.controller.js";

// The two storages exist side by side: new files go to the configured one, and files that were stored by the
// other one stay readable, so switching provider later never strands anything.
function buildAttachmentService(prisma: PrismaService, audit: IAuditLogger, permissions: IPermissionService): AttachmentService {
  const config = parseAttachmentConfig(process.env);
  const local = new LocalFileStorage(config.localDir);
  if (config.provider === "LOCAL") return new AttachmentService(prisma, audit, permissions, local, { maxBytes: config.maxBytes });
  const cloud: IFileStorage = new CloudinaryFileStorage({ cloudName: config.cloudName, apiKey: config.apiKey, apiSecret: config.apiSecret, folder: config.folder });
  return new AttachmentService(prisma, audit, permissions, cloud, { maxBytes: config.maxBytes, otherStorages: [local] });
}

@Module({
  controllers: [AttachmentsController, PicturesController],
  providers: [
    {
      provide: AttachmentService,
      useFactory: buildAttachmentService,
      inject: [PrismaService, AUDIT_LOGGER, PERMISSION_SERVICE],
    },
  ],
  exports: [AttachmentService],
})
export class AttachmentsModule {}
