import { createZodDto } from "nestjs-zod";
import { RefreshRequestSchema } from "@erp/shared";

export class RefreshDto extends createZodDto(RefreshRequestSchema) {}
