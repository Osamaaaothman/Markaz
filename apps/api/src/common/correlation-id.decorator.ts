import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { newId } from "@erp/shared";
import type { Request } from "express";
import { reqIdToString } from "./req-id.js";

// docs/03-MULTI-TENANCY-RULES.md §9 / docs/09 §7: every log line and audit record
// carries a correlationId. Prefers a caller-supplied `x-correlation-id` (so a client
// can trace a request across systems), falls back to nestjs-pino's generated
// request id (pino-http augments Express's Request with a required `id` globally —
// no need to redeclare it here), falls back to a fresh one — always something,
// never undefined.
export const CorrelationId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const header = request.headers["x-correlation-id"];
  if (typeof header === "string" && header.length > 0) {
    return header;
  }
  if (request.id !== undefined) {
    return reqIdToString(request.id);
  }
  return newId();
});
