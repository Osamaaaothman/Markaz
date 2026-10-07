import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Res,
  StreamableFile,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import {
  AttachmentError,
  AttachmentService,
  StorageError,
  type AttachmentListPage,
  type AttachmentSummary,
} from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { AttachmentContentQueryDto, AttachmentsQueryDto, UploadAttachmentDto } from "./dto/attachment-dtos.js";
import { parseAttachmentConfig } from "./attachments.config.js";

// The shape of the file multer hands over (memory storage). Declared here so no extra type package is needed.
interface UploadedFileShape {
  readonly originalname: string;
  readonly buffer: Buffer;
  readonly size: number;
}

// multer hands over the file name decoded as Latin-1 even though browsers send UTF-8, which turns an Arabic name
// into mojibake. Re-reading the same bytes as UTF-8 restores it; an all-ASCII name is unchanged.
function decodeUploadedName(name: string): string {
  return Buffer.from(name, "latin1").toString("utf8");
}

async function mapAttachmentErrors<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof StorageError) {
      if (error.code === "NOT_FOUND") throw new NotFoundException({ message: error.message, code: "FILE_MISSING" });
      throw new BadGatewayException({ message: "The file store did not accept the request", code: error.code });
    }
    if (!(error instanceof AttachmentError)) throw error;
    const body = { message: error.message, code: error.code };
    switch (error.code) {
      case "NOT_FOUND":
      case "OWNER_NOT_FOUND":
        throw new NotFoundException(body);
      case "FORBIDDEN_OWNER":
        throw new ForbiddenException(body);
      case "FILE_TOO_LARGE":
        throw new PayloadTooLargeException(body);
      case "UNSUPPORTED_FILE_TYPE":
        throw new UnsupportedMediaTypeException(body);
      case "INTEGRITY_FAILED":
        throw new InternalServerErrorException(body);
      default:
        throw new BadRequestException(body);
    }
  }
}

// The same limit the service enforces, applied while the upload is still being received so a huge file is cut
// off early instead of being read into memory first.
const MAX_BYTES = parseAttachmentConfig(process.env).maxBytes;

@Controller("v1/attachments")
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentService) {}

  // The files of one record (ownerType + ownerId) or the whole company, newest first.
  @Get()
  @RequirePermission("attachment", "read")
  list(@CurrentUser() actor: CurrentUserPayload, @Query() query: AttachmentsQueryDto): Promise<AttachmentSummary[] | AttachmentListPage> {
    if (query.ownerType && query.ownerId) return mapAttachmentErrors(this.attachments.listForOwner(actor, query.ownerType, query.ownerId));
    return mapAttachmentErrors(this.attachments.listAll(actor, query));
  }

  @Post()
  @RequirePermission("attachment", "create")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_BYTES, files: 1 } }))
  upload(
    @UploadedFile() file: UploadedFileShape | undefined,
    @Body() dto: UploadAttachmentDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<AttachmentSummary> {
    if (!file) throw new BadRequestException({ message: "A file is required", code: "FILE_REQUIRED" });
    return mapAttachmentErrors(
      this.attachments.upload({ ownerType: dto.ownerType, ownerId: dto.ownerId, fileName: decodeUploadedName(file.originalname), bytes: new Uint8Array(file.buffer) }, actor, correlationId),
    );
  }

  // The bytes, after the permission check. Served as an attachment or inline, never as something the browser may
  // run: the type comes from what the server detected at upload, and the response is sandboxed.
  @Get(":id/content")
  @RequirePermission("attachment", "read")
  async content(
    @Param("id") id: string,
    @Query() query: AttachmentContentQueryDto,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await mapAttachmentErrors(this.attachments.getContent(actor, id));
    const disposition = query.download === "true" ? "attachment" : "inline";
    response.set({
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.length),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    return new StreamableFile(Buffer.from(file.bytes));
  }

  @Delete(":id")
  @RequirePermission("attachment", "delete")
  async remove(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<{ removed: true }> {
    const removed = await mapAttachmentErrors(this.attachments.remove(actor, id, correlationId));
    if (!removed) throw new NotFoundException({ message: "Attachment not found", code: "NOT_FOUND" });
    return { removed: true };
  }
}
