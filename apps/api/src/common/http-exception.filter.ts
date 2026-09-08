import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { reqIdToString } from "./req-id.js";

// One error shape everywhere — docs/07-API-RULES.md §4. `code` is the stable,
// machine-readable field the frontend switches on; `message` is a translation key
// once i18n exists (M3) — for now it is an English fallback description, never a
// leaked stack trace, SQL fragment, or internal id.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const code =
      exception instanceof HttpException
        ? (exception.constructor.name.replace(/Exception$/, "").toUpperCase())
        : "INTERNAL_ERROR";

    const message =
      exception instanceof HttpException ? exception.message : "An unexpected error occurred";

    response.status(status).json({
      error: { code, message, details: [] },
      correlationId: request.id !== undefined ? reqIdToString(request.id) : undefined,
    });
  }
}
