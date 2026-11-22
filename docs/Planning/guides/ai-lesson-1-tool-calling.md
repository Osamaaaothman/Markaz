# الدرس 1 — استدعاء الأدوات (Tool Calling): النموذج يطلب، وكودنا ينفّذ

## الفكرة في 5 أسطر

1. النموذج اللغوي دالة من نص إلى نص؛ لا يفتح قاعدة بيانات ولا ينفّذ كوداً بنفسه أبداً.
2. نعطيه قائمة أدوات، لكل أداة اسم ووصف وJSON Schema للمدخلات مأخوذ من مخطط Zod.
3. عندما يحتاج أداة يرد بطلب استدعاء `tool_calls` (اسم الأداة + الوسائط) بدل نص عادي.
4. كودنا يتحقق من الشكل بـ Zod ومن صلاحية المستخدم، ثم ينفّذ الأداة ويعيد النتيجة إلى النموذج.
5. تتكرر الحلقة حتى يرد النموذج نصاً نهائياً؛ ووصف الأداة وأسماء الحقول هما واجهتها الحقيقية.

## التدفق

```text
المستخدم: "أنشئ موظفاً اسمه أسامة براتب 3000.00"
        │
        ▼
[1] الخادم يرسل: الرسالة + الأدوات (name + description + Zod schema)
        │
        ▼
[2] النموذج يرد: AIMessage { tool_calls: [{ name: "hr_createEmployee", args: {...} }] }
        │
        ▼
[3] كودنا (عقدة tools في packages/ai/src/graph/assistant-graph.ts)
        ├─ الأداة موجودة؟              لا ──► ToolMessage { error: "UNKNOWN_TOOL" }
        ├─ ctx.can(resource, action)?  لا ──► ToolMessage { error: "FORBIDDEN" }
        ├─ tool.input.safeParse        لا ──► ToolMessage { error: "INVALID_ARGUMENTS" }
        └─ read: tool.run()  |  write: preview ثم اقتراح أو تنفيذ
        │
        ▼
[4] ToolMessage بالنتيجة ──► النموذج (نتيجة القراءة مغلّفة داخل untrusted_data)
        │
        ▼
[5] هل في الرد tool_calls؟  لا ──► رد نصي نهائي للمستخدم
                            نعم ──► عودة إلى [2] (حتى حد الخطوات)
```

## أصغر مثال يعمل

ثبّت الحزم: `npm i @langchain/openai @langchain/core zod`. المثال يستخدم نفس شكل الأدوات الذي يستخدمه `packages/ai` في `bindTools` (كائن فيه `name` و`description` و`schema` من Zod)، ويوضّح أن التنفيذ يحدث في دالتنا لا في النموذج.

```ts
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
const tools = [{
  name: "get_employee_salary",
  description: "Return the monthly basic salary of one employee. Use only when the user names that employee.",
  schema: z.object({ name: z.string().describe("Employee full name, as the user wrote it") }),
}];

async function ask(text: string): Promise<string> {
  const bound = model.bindTools(tools);
  const messages: BaseMessage[] = [new HumanMessage(text)];
  for (let step = 0; step < 4; step++) {
    const ai = await bound.invoke(messages);
    messages.push(ai);
    if (!ai.tool_calls?.length) return String(ai.content);
    for (const call of ai.tool_calls) {
      const input = tools[0]!.schema.parse(call.args); // كودنا يتحقق؛ النموذج طلب فقط
      const salary = input.name.includes("أسامة") ? "3000.00" : "0.00";
      messages.push(new ToolMessage({ content: salary, tool_call_id: call.id!, name: call.name }));
    }
  }
  return "STEP_LIMIT";
}

console.log(await ask("كم راتب أسامة؟"));
```

## أين يوجد في كودنا

- `packages/ai/src/tools/types.ts` — `defineReadTool` و`defineWriteTool` و`ReadTool` و`WriteTool` و`ErpTool` و`ToolContext` و`ChangePreview`. الحقل `input` هو مخطط Zod، والحقل `description` هو ما يقرأه النموذج.
- `packages/ai/src/graph/assistant-graph.ts` — `runAssistant` يبني `llmTools` من `name` و`description` و`schema`، ثم `opts.model.bindTools(llmTools)`. عقدة `tools` هي التي تتحقق بـ `tool.input.safeParse` وتستدعي `tool.run` أو `tool.preview` ثم `tool.execute`. أي تنفيذ فعلي يحدث هنا، لا في النموذج.
- `apps/api/src/ai/tools/erp-tools.ts` — `buildErpTools` فيه أدوات حقيقية مثل `parties_search` (قراءة) و`hr_createEmployee` (كتابة). لاحظ `description` المكتوب بعناية، و`z.string().regex(...)` للمبالغ، و`describe(...)` على الحقول.
- `packages/ai/src/tools/policy.ts` — `toolsForMode` يخفي أدوات الكتابة في وضع `ask`، و`permittedTools` يخفي ما لا يملك المستخدم صلاحيته.
- `packages/ai/src/graph/assistant-graph.spec.ts` — اختبارات تثبت السلوك: نتيجة أداة القراءة تصل للنموذج داخل `untrusted_data`، والوسائط السيئة ترجع `INVALID_ARGUMENTS`، وأداة غير مسموحة ترجع `FORBIDDEN`.

## جرّب بنفسك

1. في `apps/api/src/ai/tools/erp-tools.ts` غيّر وصف `parties_search` إلى جملة مبهمة مثل `"Search."`، ثم اسأل المساعد: «ابحث عن عميل اسمه النور». لاحظ أنه قد لا يستدعي الأداة أصلاً أو يستدعيها بوسائط خاطئة. أعد الوصف الأصلي وقارن.
2. في نفس الملف غيّر `basicSalary: decimal` في `employeeInput` إلى `z.string()`، ثم اطلب موظفاً براتب «ثلاثة آلاف». لاحظ أن خطأ `INVALID_ARGUMENTS` اختفى وأن الحماية انتقلت إلى الخدمة الأساسية أو ضاعت. هذا يثبت أن مخطط Zod هو الحارس الأول.
3. في `packages/ai/src/tools/policy.ts` اجعل `toolsForMode` تعيد كل الأدوات حتى في وضع `ask`، ثم اطلب إنشاء عميل. لاحظ أن النموذج صار يرى أداة الكتابة ويقترحها؛ هذا يثبت أن الإخفاء في الكود هو المنع الحقيقي، لا جملة في الـ prompt.

## أخطاء شائعة

- **الاعتقاد أن النموذج ينفّذ:** تنظر إلى قاعدة البيانات بعد وصول `tool_calls` فلا تجد أثراً. هذا طبيعي؛ لم يُنفّذ شيء بعد. التنفيذ في عقدة `tools` فقط.
- **وصف غامض أو اسم حقل غامض:** النموذج يخمّن المعنى فيرسل وسائط ناقصة أو خاطئة. الوصف جزء من الكود ويستحق المراجعة والاختبار مثل أي واجهة.
- **نسيان `describe` على حقول Zod:** الحقول بلا شرح تنتج قيماً غير متوقعة، خصوصاً التواريخ والمبالغ. قارن `employeeInput` في `erp-tools.ts`.
- **الاعتماد على الـ prompt لمنع الكتابة:** كتابة «لا تنفّذ شيئاً» لا تمنع شيئاً. المنع الحقيقي هو عدم تمرير أدوات الكتابة أصلاً (`toolsForMode`) وفحص الصلاحية في الكود.
- **إرجاع بيانات كثيرة من أداة قراءة:** الحقل `data` يذهب إلى النموذج ويكلّف tokens؛ اجعله أصغر ما يكفي للإجابة، واستخدم `display` لعرض الجدول في الواجهة.
