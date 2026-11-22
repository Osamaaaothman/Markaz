# الدرس 2 — البث المباشر (Streaming): SSE فوق طلب POST

## الفكرة في 5 أسطر

1. الرد الطويل لا يُنتظر حتى يكتمل؛ الخادم يفتح الاستجابة ويرسل أجزاء صغيرة أثناء العمل.
2. نستخدم Server-Sent Events: إطار نصي بسيط ينتهي بسطر فارغ (`\n\n`)، وداخله سطر `data: {json}`.
3. نستخدم POST لأن رسالة المستخدم في جسم الطلب، و`EventSource` لا يدعم POST ولا ترويسة المصادقة.
4. الواجهة تقرأ الجسم بـ `fetch` + `ReadableStream`، وتفصل الإطارات على `\n\n`، وتطبّق كل حدث على الرسالة.
5. عند إغلاق الصفحة أو الضغط على «إيقاف» يُلغى الطلب بـ `AbortSignal`، فيتوقف الخادم عن توليد tokens.

## التدفق

```text
المتصفح
  │  POST /api/v1/ai/messages   (JSON + Authorization: Bearer)
  ▼
apps/api/src/ai/ai.controller.ts  →  stream()
  │  Content-Type: text/event-stream
  │  Cache-Control: no-cache, no-transform
  │  X-Accel-Buffering: no        ← حتى لا يحبس nginx الإطارات
  ▼
AiChatService.send()  →  runAssistant()  →  emit(event)
  │
  ├─ { type: "conversation", id, title }
  ├─ { type: "token", text }            ← كل جزء من نص النموذج
  ├─ { type: "tool_start", ... } / { type: "tool_end", ... }
  ├─ { type: "display", block } / { type: "proposed", item }
  └─ { type: "done", messageId, status, usage }
  │
  ▼  res.write(`data: ${JSON.stringify(e)}\n\n`)
الشبكة  ──►  fetch().body.pipeThrough(new TextDecoderStream())
  │
  ▼
apps/web/src/features/ai/ai-api.ts  →  streamChat()  →  onEvent(e)
  │
  ▼
chat-events.ts  →  applyEvent(message, e)  →  تحديث الواجهة

إغلاق/إيقاف:
  المستخدم ──► AbortController.abort() ──► fetch يرمي AbortError
  الخادم   ──► res.on("close") ──► abort.abort() ──► signal يصل إلى النموذج
```

## أصغر مثال يعمل

هذا المثال يقرأ أي استجابة SSE بنفس طريقة `streamChat` في المستودع: `fetch` + `TextDecoderStream` + مخزن نصي يُقسّم على `\n\n`. يعمل في Node 18+؛ وفي المتصفح استبدل `process.stdout.write` بعرض النص في الواجهة.

```ts
const token = process.env.ERP_TOKEN ?? "";
const base = process.env.ERP_URL ?? "http://localhost:3000";
const controller = new AbortController();
const res = await fetch(`${base}/api/v1/ai/messages`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ text: "كم مبيعات هذا الشهر؟", mode: "ask", locale: "ar" }),
  signal: controller.signal, // استدعِ controller.abort() لإيقاف البث
});
if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
let buffer = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += value;
  let index: number;
  while ((index = buffer.indexOf("\n\n")) >= 0) {
    const frame = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    const line = frame.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    const event = JSON.parse(line.slice(6)) as { type: string; text?: string };
    if (event.type === "token") process.stdout.write(event.text ?? "");
    if (event.type === "done") console.log("\n[done]");
  }
}
```

## أين يوجد في كودنا

- `apps/api/src/ai/ai.controller.ts` — الدالة `stream()`: تضبط `text/event-stream` و`X-Accel-Buffering: no`، وتكتب `data: ...\n\n`، وتسجّل `res.on("close", ...)` لإلغاء `AbortController` عندما يغادر العميل. كذلك `send` و`decide` يمرّان عبرها.
- `apps/api/src/ai/ai-chat.service.ts` — النوع `ChatEvent` (أحداث المحرّك + `conversation` و`outcome` و`done` و`error`)، والدالتان `send` و`decide` تستقبلان `emit` و`signal`.
- `packages/ai/src/graph/events.ts` — `AssistantEvent`: `token` و`tool_start` و`tool_end` و`display` و`proposed` و`executed` و`clarify` و`step_limit`.
- `packages/ai/src/graph/assistant-graph.ts` — عقدة `agent` تبثّ `token` لكل جزء من النموذج، وعقدة `tools` تبثّ `tool_start` و`tool_end`، وتمرير `signal` إلى `bound.stream(...)` وإلى `graph.invoke(...)`.
- `apps/web/src/features/ai/ai-api.ts` — `streamChat`: تعليق صريح يشرح لماذا لا نستخدم `EventSource`، ومعالجة إعادة المحاولة بعد 401، وفصل الإطارات على `\n\n`.
- `apps/web/src/features/ai/chat-events.ts` — `applyEvent`: دالة نقية تضيف `token` إلى النص وتحدّث الخط الزمني والبطاقات.
- `apps/web/src/features/ai/use-assistant-chat.ts` — `AbortController` في `run`، و`stop()`، والإلغاء عند `newChat` و`openConversation`.

## جرّب بنفسك

1. في `apps/web/src/features/ai/ai-api.ts` غيّر `buffer.indexOf("\n\n")` إلى `buffer.indexOf("\n")`. لاحظ أن الإطارات تُقطع في منتصف JSON وأن معظم الأحداث تُتجاهل بصمت (كتلة `catch` الفارغة). أعدها إلى `\n\n`.
2. في `apps/api/src/ai/ai.controller.ts` احذف سطر `res.setHeader("X-Accel-Buffering", "no")` ثم شغّل النظام خلف nginx واطلب إجابة طويلة. لاحظ أن النص يظهر دفعة واحدة بعد اكتمال الرد بدل أن يتدفق.
3. في `apps/web/src/features/ai/use-assistant-chat.ts` احذف `abortRef.current?.abort()` من `newChat`، ثم أرسل سؤالاً طويلاً واضغط «محادثة جديدة» أثناء البث. لاحظ أن الخادم يستمر في العمل ويستهلك tokens حتى ينتهي. أعد السطر.

## أخطاء شائعة

- **استخدام `EventSource` أو Axios:** `EventSource` لا يدعم POST ولا ترويسة `Authorization`، وAxios ينتظر اكتمال الجسم فيختفي البث. الحل هو `fetch` + قارئ stream كما في `streamChat`.
- **تقسيم الإطارات على سطر واحد `\n`:** إطار SSE ينتهي بسطر فارغ (`\n\n`)؛ التقسيم الخاطئ ينتج JSON مقطوعاً وأحداثاً مفقودة.
- **نسيان `res.flushHeaders()` أو تعطيل buffering:** تصل كل الأحداث دفعة واحدة، ويظن المستخدم أن البث لا يعمل. لذلك يوجد `X-Accel-Buffering: no`.
- **عدم تمرير `signal` إلى النموذج:** الإيقاف يقطع الشبكة فقط، بينما يستمر الخادم في توليد tokens ودفع التكلفة. في كودنا يصل `signal` إلى `bound.stream` و`graph.invoke`.
- **محاولة إرسال خطأ HTTP بعد بدء البث:** لا يمكن تغيير رمز الحالة بعد إرسال أول بايت؛ لذلك الأخطاء اللاحقة تُرسل كحدث `{ type: "error", code }` ثم `done`.
