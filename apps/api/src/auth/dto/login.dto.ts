import { createZodDto } from "nestjs-zod";
import { LoginRequestSchema } from "@erp/shared";

export class LoginDto extends createZodDto(LoginRequestSchema) {}
