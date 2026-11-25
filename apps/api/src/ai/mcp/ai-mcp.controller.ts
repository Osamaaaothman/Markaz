import { Controller, Delete, Get, Inject, Post, Req, Res } from "@nestjs/common";
import { permittedTools, wrapUntrusted, type ErpTool, type ToolContext } from "@erp/ai";
import type { IPermissionService } from "@erp/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { AllowAccessToken } from "../../auth/allow-access-token.decorator.js";
import { CurrentUser, type CurrentUserPayload } from "../../auth/current-user.decorator.js";
import { PERMISSION_SERVICE } from "../../identity/identity.tokens.js";
import { RequirePermission } from "../../identity/require-permission.decorator.js";
import { AI_TOOLS } from "../ai.tokens.js";

// The same tools, offered to an external AI client (Claude Desktop, Cursor, ...) over the Model
// Context Protocol — Streamable HTTP, stateless (a new server per request).
//
// Read tools only: an external client does not go through our approval cards, so it must never be
// able to change anything. Authentication is the normal API bearer token or a personal access token
// (Settings → MCP access tokens), and every tool is filtered and re-checked against the caller's own
// permissions.
@Controller("v1/ai/mcp")
export class AiMcpController {
  constructor(
    @Inject(AI_TOOLS) private readonly tools: readonly ErpTool[],
    @Inject(PERMISSION_SERVICE) private readonly permissions: IPermissionService,
  ) {}

  @Post()
  @AllowAccessToken()
  @RequirePermission("ai_assistant", "use")
  async handle(@CurrentUser() actor: CurrentUserPayload, @Req() req: Request, @Res() res: Response): Promise<void> {
    const ctx: ToolContext = {
      actor: { userId: actor.id, companyId: actor.companyId },
      locale: "en",
      conversationId: "mcp",
      correlationId: "ai:mcp",
      can: (resource, action) => this.permissions.can(actor.id, action, resource, actor.companyId),
    };
    const reads = await permittedTools(this.tools.filter((t) => t.kind === "read"), ctx);
    const server = new McpServer({ name: "erp-lite", version: "1.0.0" });
    for (const tool of reads) {
      if (tool.kind !== "read") continue;
      server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input }, async (args: unknown) => {
        const parsed = tool.input.safeParse(args);
        if (!parsed.success) return { isError: true, content: [{ type: "text" as const, text: "INVALID_ARGUMENTS" }] };
        if (!(await ctx.can(tool.permission.resource, tool.permission.action))) return { isError: true, content: [{ type: "text" as const, text: "FORBIDDEN" }] };
        const result = await tool.run(ctx, parsed.data);
        return { content: [{ type: "text" as const, text: wrapUntrusted(result.data) }] };
      });
    }
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true }); // no sessionIdGenerator = stateless
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  // Stateless server: no session stream to open or close.
  @Get()
  @RequirePermission("ai_assistant", "use")
  sse(@Res() res: Response): void {
    res.status(405).json({ code: "METHOD_NOT_ALLOWED" });
  }

  @Delete()
  @RequirePermission("ai_assistant", "use")
  end(@Res() res: Response): void {
    res.status(405).json({ code: "METHOD_NOT_ALLOWED" });
  }
}
