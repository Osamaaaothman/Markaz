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
