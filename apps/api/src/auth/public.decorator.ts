import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

// docs/07-API-RULES.md §8: "Authentication on every route by default; public routes
// are explicitly opted out and listed in one place." This decorator IS that one
// place — grep for @Public() to see the full list.
export const Public = (): MethodDecorator => SetMetadata(IS_PUBLIC_KEY, true);
