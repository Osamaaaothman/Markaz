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
import { SalesInvoicePdfService } from "../../sales/sales-invoice-pdf.service.js";
import { AI_TOOLS } from "../ai.tokens.js";
import { AiChatError, AiChatService } from "../ai-chat.service.js";
import type { RequestAccessToken } from "./access-tokens.js";

// The same tools, offered to an external AI client (Claude Desktop, Cursor, ...) over the Model
// Context Protocol — Streamable HTTP, stateless (a new server per request).
//
// Read tools for everyone. Write tools only for a personal token of scope "review" (every change becomes
// a card the user approves in the app) or "write" (full access: every change runs at once; the MCP
// client is the one that asks its user before each call). A login token never gets write tools here. Authentication is the normal API bearer token or a personal access token
// (Settings → MCP access tokens), and every tool is filtered and re-checked against the caller's own
// permissions.
@Controller("v1/ai/mcp")
export class AiMcpController {
  constructor(
    @Inject(AI_TOOLS) private readonly tools: readonly ErpTool[],
    @Inject(PERMISSION_SERVICE) private readonly permissions: IPermissionService,
    @Inject(AiChatService) private readonly chat: AiChatService,
    @Inject(SalesInvoicePdfService) private readonly invoicePdfs: SalesInvoicePdfService,
  ) {}

  // In the app a "file" result is a card the browser downloads. An MCP client has no such card, so the
  // document itself goes back as an embedded PDF resource. Only paths with a known renderer are served.
  private async fileContent(companyId: string, apiPath: string): Promise<{ type: "resource"; resource: { uri: string; mimeType: string; blob: string } } | null> {
    const match = /^\/v1\/sales-invoices\/([0-9a-f-]{36})\/pdf$/.exec(apiPath);
    if (!match?.[1]) return null;
    const pdf = await this.invoicePdfs.render(companyId, match[1], "en");
    return { type: "resource", resource: { uri: `erp://sales-invoices/${match[1]}/${pdf.fileName}`, mimeType: "application/pdf", blob: pdf.bytes.toString("base64") } };
  }

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
        const text = { type: "text" as const, text: wrapUntrusted(result.data) };
        const file = result.display?.kind === "file" ? await this.fileContent(actor.companyId, result.display.apiPath).catch(() => null) : null;
        return { content: file ? [text, file] : [text] };
      });
    }
    const token = (req as Request & { accessToken?: RequestAccessToken }).accessToken;
    if (token && token.scope !== "read") {
      const scope = token.scope;
      const writes = await permittedTools(this.tools.filter((t) => t.kind === "write"), ctx);
      const note = scope === "review"
        ? " Nothing is saved by this call: it becomes a card the user approves in the app's assistant."
        : " The change is saved at once.";
      for (const tool of writes) {
        // Hints for the client's own approval prompt: nothing here is read-only, high-risk tools post or pay.
        const annotations = { readOnlyHint: false, destructiveHint: tool.kind === "write" && tool.risk === "high", openWorldHint: false };
        server.registerTool(tool.name, { description: tool.description + note + ' A later call may use "$ref:<id>.id" to point at an earlier result.', inputSchema: tool.input, annotations }, async (args: unknown) => {
          try {
            const r = await this.chat.externalWrite(actor, { id: token.id, name: token.name, scope }, tool.name, (args ?? {}) as Record<string, unknown>);
            return { content: [{ type: "text" as const, text: JSON.stringify(r.status === "EXECUTED"
              ? { status: "EXECUTED", id: r.id, result: wrapUntrusted(r.data), link: r.link?.path ?? null, warnings: r.warnings }
              : { status: "PROPOSED", id: r.id, note: "Waiting for the user's approval on the card in the app (assistant).", warnings: r.warnings }) }] };
          } catch (error) {
            if (error instanceof AiChatError) return { isError: true, content: [{ type: "text" as const, text: error.detail ? `${error.code}: ${error.detail}` : error.code }] };
            const code = (error as { code?: unknown }).code;
            const message = typeof code === "string" && error instanceof Error ? `${code}: ${error.message.slice(0, 300)}` : "TOOL_FAILED";
            return { isError: true, content: [{ type: "text" as const, text: message }] };
          }
        });
      }
    }
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true }); // no sessionIdGenerator = stateless
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  // Stateless server: no session stream to open or close. Both routes accept the MCP token so a client
  // gets the 405 it expects, not a 401 that looks like a bad token.
  @Get()
  @AllowAccessToken()
  @RequirePermission("ai_assistant", "use")
  sse(@Res() res: Response): void {
    res.status(405).json({ code: "METHOD_NOT_ALLOWED" });
  }

  @Delete()
  @AllowAccessToken()
  @RequirePermission("ai_assistant", "use")
  end(@Res() res: Response): void {
    res.status(405).json({ code: "METHOD_NOT_ALLOWED" });
  }
}
