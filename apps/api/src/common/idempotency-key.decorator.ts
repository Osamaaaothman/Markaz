import { BadRequestException, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

// docs/04-DATA-MODEL-RULES.md §6 / docs/07-API-RULES.md §5: "Every financial
// mutation endpoint accepts an Idempotency-Key header." Required, not optional —
// an idempotency mechanism nobody is forced to use does not prevent double-posting.
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const header = request.headers["idempotency-key"];
  if (typeof header === "string" && header.length > 0) {
    return header;
  }
  throw new BadRequestException("Idempotency-Key header is required");
});

// Backwards-compatible commercial document creation; financial posting still requires the key.
export const OptionalIdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const header = ctx.switchToHttp().getRequest<Request>().headers["idempotency-key"];
  if (header === undefined) return undefined;
  if (typeof header !== "string" || header.length < 1 || header.length > 128) throw new BadRequestException("Invalid Idempotency-Key");
  return header;
});
