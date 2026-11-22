# الدرس 6 — MCP: نافذة خارجية لأدواتنا

## الفكرة في 5 أسطر

1. MCP بروتوكول JSON-RPC موحّد يعرض أدوات وموارد لأي عميل AI خارجي مثل Claude Desktop أو Cursor.
2. الشات الداخلي لا يحتاج MCP؛ يستدعي الأدوات مباشرة. MCP للعميل الخارجي فقط.
3. خادمنا يعرض أدوات القراءة فقط، لأن العميل الخارجي لا يمرّ ببطاقات الموافقة لدينا.
4. نستخدم Streamable HTTP بلا جلسات: كل طلب POST مستقل، وخادم جديد يُبنى لكل طلب.
5. التعريف واحد: نفس `ErpTool` يُعرض لـ LangChain داخلياً ولـ MCP خارجياً، والمصادقة توكن API العادي.

## التدفق

```text
Claude Desktop / Cursor
  │  POST /api/v1/ai/mcp        Authorization: Bearer <token>
  │  Content-Type: application/json
  │  Accept: application/json, text/event-stream
  ▼
AiMcpController.handle()
  │  1) يبني ToolContext من المستخدم الحالي
  │  2) permittedTools(tools.filter(t => t.kind === "read"))
  │  3) new McpServer({ name: "erp-lite", version: "1.0.0" })
  │  4) لكل أداة: server.registerTool(name, { description, inputSchema }, callback)
  ▼
StreamableHTTPServerTransport({ enableJsonResponse: true })   ← بلا sessionId = stateless
  │
  ├─ initialize      ──► capabilities + serverInfo
  ├─ tools/list      ──► أسماء الأدوات ووصفها وJSON Schema
  └─ tools/call      ──► فحص input.safeParse
                          فحص ctx.can(resource, action) مرة أخرى
                          tool.run(ctx, args)
                          wrapUntrusted(data)
  ▼
JSON-RPC result: { content: [{ type: "text", text: "{\"untrusted_data\":...}" }] }
```

## أصغر مثال يعمل

ثبّت: `npm i @modelcontextprotocol/sdk zod`. المثال يعرض أداة قراءة واحدة بـ `registerTool` بنفس الشكل المستخدم في `apps/api/src/ai/mcp/ai-mcp.controller.ts`. في الـ ERP الوسيط هو `StreamableHTTPServerTransport`، وهنا `StdioServerTransport` ليعمل الملف وحده مع MCP Inspector أو أي عميل stdio.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const input = z.object({ query: z.string().min(1).max(100) });
const server = new McpServer({ name: "erp-lite-demo", version: "1.0.0" });

server.registerTool(
  "employees_search",
  { description: "Search employees by name. Returns basic salary and hire date.", inputSchema: input },
  async (args) => {
    const parsed = input.safeParse(args);
    if (!parsed.success) return { isError: true, content: [{ type: "text" as const, text: "INVALID_ARGUMENTS" }] };
    const rows = [{ ref: "EMP-0001", name: "أسامة", basicSalary: "3000.00" }]
      .filter((r) => r.name.includes(parsed.data.query));
    return { content: [{ type: "text" as const, text: JSON.stringify({ untrusted_data: JSON.stringify(rows) }) }] };
  },
);

await server.connect(new StdioServerTransport());
```

**كيف يُستدعى خادمنا (JSON-RPC).** العنوان في مثالنا `https://erp.example.com/api/v1/ai/mcp`. كل طلب يحتاج ترويسة `Authorization: Bearer <access token>` و`Content-Type: application/json` و`Accept: application/json, text/event-stream`.

```bash
# 1) initialize
curl -sS https://erp.example.com/api/v1/ai/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'

# 2) tools/list
curl -sS https://erp.example.com/api/v1/ai/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# 3) tools/call
curl -sS https://erp.example.com/api/v1/ai/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"parties_search","arguments":{"query":"النور","kind":"ANY"}}}'
```

بعد `initialize` يرسل العميل عادةً إشعاراً بلا `id`: `{"jsonrpc":"2.0","method":"notifications/initialized"}`. خادمنا stateless فلا يحفظ جلسة بين الطلبات؛ لا يوجد `Mcp-Session-Id`، وطلبا `GET` و`DELETE` على نفس المسار يعيدان `405 METHOD_NOT_ALLOWED` عن قصد.

## أين يوجد في كودنا

- `apps/api/src/ai/mcp/ai-mcp.controller.ts` — `AiMcpController.handle`: بناء `ToolContext`، ثم `permittedTools(this.tools.filter((t) => t.kind === "read"))`، ثم `new McpServer`، ثم `server.registerTool(tool.name, { description, inputSchema: tool.input }, callback)`. داخل الـ callback: `input.safeParse` ثم `ctx.can` مرة أخرى ثم `tool.run` ثم `wrapUntrusted`. وبعده `new StreamableHTTPServerTransport({ enableJsonResponse: true })` مع تعليق صريح أنه stateless. و`GET`/`DELETE` يعيدان 405.
- `packages/ai/src/tools/types.ts` — `ReadTool` و`defineReadTool` و`ToolContext`: نفس التعريف الذي يستهلكه الشات الداخلي.
- `apps/api/src/ai/tools/erp-tools.ts` — `buildErpTools` والأدوات السبعة للقراءة (`dashboard_overview`, `reports_monthlyRevenueExpense`, `parties_search`, `employees_search`, `items_search`, `salesInvoices_search`, `accounts_search`).
- `packages/ai/src/tools/policy.ts` — `permittedTools`: إخفاء أي أداة لا يملك المستخدم صلاحيتها.
- `packages/ai/src/safety/untrusted.ts` — `wrapUntrusted`: النتيجة تصل للعميل الخارجي داخل غلاف البيانات أيضاً.
- `apps/api/src/ai/ai.tokens.ts` — `AI_TOOLS`، رمز الحقن الذي يوفّر قائمة الأدوات للـ controller.
- `apps/api/src/identity/require-permission.decorator.ts` — `RequirePermission`: كل مسارات MCP تتطلب `ai_assistant:use`.

## جرّب بنفسك

1. في `apps/api/src/ai/mcp/ai-mcp.controller.ts` احذف `.filter((t) => t.kind === "read")` من سطر `permittedTools`. ثم أرسل `tools/list` ولاحظ ظهور أدوات الكتابة مثل `hr_createEmployee`. أعد الفلتر؛ هذا يوضّح لماذا القراءة فقط ليست صدفة.
2. في نفس الملف احذف فحص `ctx.can(...)` داخل الـ callback، ثم استخدم توكناً لمستخدم لا يملك `employee:read` واستدعِ `employees_search`. لاحظ أن الأداة قد تعمل رغم أن القائمة فُلترت سابقاً؛ الفحص الثاني هو دفاع في العمق ضد تغيّر الصلاحية بين الطلبين.
3. أرسل أوامر `curl` الثلاثة أعلاه بالترتيب، ثم أرسل `GET` لنفس المسار. لاحظ أن `initialize` يعيد `serverInfo`، و`tools/list` يعيد مخطط `query`، و`tools/call` يعيد النص داخل `untrusted_data`، وأن `GET` يعيد 405.

**كيف يتصل Claude Desktop.** أحدث إصدارات Claude Desktop تسمح بإضافة موصل (Connector) بعيد: العنوان `https://erp.example.com/api/v1/ai/mcp` مع ترويسة `Authorization: Bearer <token>`. وإن كنت على إصدار يعتمد على خوادم stdio فقط، استخدم جسر `mcp-remote` في `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "erp-lite": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://erp.example.com/api/v1/ai/mcp",
        "--header",
        "Authorization: Bearer YOUR_TOKEN"
      ]
    }
  }
}
```

بعد إعادة تشغيل Claude Desktop ستظهر أدوات القراءة في قائمة الأدوات، وكل استدعاء يمر بصلاحيات المستخدم صاحب التوكن.

## أخطاء شائعة

- **توقّع بطاقات موافقة في MCP:** العميل الخارجي لا يرى واجهتنا ولا بطاقاتنا، فأي أداة كتابة تعني تنفيذاً بلا موافقة. لذلك الخادم للقراءة فقط.
- **فتح `GET` لبث SSE:** خادمنا stateless ويرفض `GET` و`DELETE` بـ 405؛ العميل الذي يبدأ بـ GET سيفشل. ابدأ بـ POST.
- **نسيان ترويسة المصادقة:** النتيجة 401 أو 403 قبل وصول أي JSON-RPC. التوكن هو توكن API العادي وليس مفتاح LLM.
- **إرجاع نص خام بدل `content`:** يجب أن يكون الرد `{ content: [{ type: "text", text: "..." }] }`، وإلا يرفض العميل النتيجة كخطأ تحقق.
- **الاعتقاد أن `initialize` يحفظ جلسة:** كل POST يبني `McpServer` جديداً؛ لا تعتمد على حالة محفوظة بين الطلبات، وأرسل ما يحتاجه كل طلب.
