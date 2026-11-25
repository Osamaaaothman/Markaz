import { SetMetadata } from "@nestjs/common";

export const ALLOW_ACCESS_TOKEN_KEY = "allowAccessToken";

// The routes a personal MCP access token may call (grep for @AllowAccessToken() to see them all).
// Every other route accepts only the short-lived login token (docs/09-SECURITY-RULES.md).
export const AllowAccessToken = (): MethodDecorator => SetMetadata(ALLOW_ACCESS_TOKEN_KEY, true);
