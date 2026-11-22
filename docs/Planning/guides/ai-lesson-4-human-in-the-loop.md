# الدرس 4 — الإنسان في الحلقة: الاقتراح والموافقة والتنفيذ

## الفكرة في 5 أسطر

1. ثلاث حالات: `ask` قراءة فقط، و`review` كل كتابة تصبح بطاقة، و`auto` منخفض الخطورة يُنفّذ فوراً إن سُمح.
2. `needsApproval` يقرّر: الخطورة `high` تطلب موافقة دائماً، حتى في الوضع التلقائي.
3. كل اقتراح يأخذ معرّفاً `c1` و`c2`، والخطوة اللاحقة تشير إلى نتيجة السابقة بـ `$ref:c1.id`.
4. المستخدم يوافق أو يرفض أو يعدّل؛ `executeDecisions` ينفّذ المعتمد بالترتيب، ويتخطى ما اعتمد على خطوة لم تُنفّذ.
5. القرار النهائي يُثبّت في `ai_change_items`، ومُشغّل قاعدة البيانات يمنع تعديل أي صف خرج من `PROPOSED`.

## التدفق

```text
النموذج ──► write tool
              │
              ▼
        tool.preview()        ← لا يكتب شيئاً، يبني بطاقة المعاينة
              │
              ▼
   needsApproval?  لا (auto + low) ──► tool.execute() ──► executed
              │ نعم
              ▼
   ProposedItem { id: "c1", risk, dependsOn: ["..."] }
              │
              ▼
   ai_change_items (PROPOSED) + conversation = AWAITING_APPROVAL
              │
              ▼
   الواجهة تعرض البطاقات: قبول / تعديل / رفض
              │
              ▼
   POST /v1/ai/conversations/:id/decisions
              │
              ├─ updateMany(status: AWAITING_APPROVAL → IDLE)
              │     count !== 1 ──► NOTHING_TO_DECIDE (نقر مزدوج)
              ▼
   executeDecisions()
        ├─ رفض ──► REJECTED
        ├─ اعتماد على غير منفّذ ──► SKIPPED
        ├─ فحص صلاحية + resolveRefs + Zod ──► FAILED عند الخطأ
        └─ tool.execute() ──► EXECUTED
              │
              ▼
   outcomesMessage ──► runTurn جديدة ──► ملخص نصي للمستخدم
```

## أصغر مثال يعمل

ثبّت: `npm i @langchain/core zod`. المثال يعزل الفكرة بلا ERP: النموذج ينتج `tool_calls`، فنحوّلها إلى اقتراحات، ثم ننفّذ قرار المستخدم بالترتيب مع حل `$ref` وتخطي التابع المرفوض. يستخدم `AIMessage` من `@langchain/core/messages` كما في كودنا، وZod للتحقق.

```ts
import { AIMessage } from "@langchain/core/messages";
import { z } from "zod";

const employeeInput = z.object({ name: z.string(), salary: z.string().regex(/^\d+\.\d{2}$/) });
const ai = new AIMessage({ content: "", tool_calls: [
  { id: "t1", name: "createSupplier", args: { name: "أسامة" } },
  { id: "t2", name: "createEmployee", args: { name: "أسامة", salary: "3000.00", supplierId: "$ref:c1.id" } },
]});

// 1) كل نداء كتابة يصبح اقتراحاً c1, c2... ولم يُنفّذ شيء بعد.
const proposals = (ai.tool_calls ?? []).map((c, i) => ({
  id: `c${i + 1}`, tool: c.name, args: c.args as Record<string, unknown>, risk: "low" as const,
  dependsOn: JSON.stringify(c.args).match(/\$ref:(c\d+)\./g)?.map((r) => r.slice(5, -1)) ?? [],
}));

// 2) قرار المستخدم: رفض c1 واعتماد c2.
const decisions: Record<string, "approve" | "reject"> = { c1: "reject", c2: "approve" };
const results = new Map<string, Record<string, unknown>>();

// 3) التنفيذ بالترتيب؛ التابع المرفوض يُتخطى ولا يُنفّذ بقيمة ناقصة.
for (const p of proposals) {
  if (decisions[p.id] !== "approve") { console.log(p.id, "REJECTED"); continue; }
  if (p.dependsOn.some((d) => !results.has(d))) { console.log(p.id, "SKIPPED"); continue; }
  const resolved = JSON.parse(JSON.stringify(p.args), (_k, v) =>
    typeof v === "string" && v.startsWith("$ref:") ? results.get(v.slice(5).split(".")[0]!) ?? v : v);
  if (p.tool === "createEmployee" && !employeeInput.safeParse(resolved).success) { console.log(p.id, "INVALID_ARGUMENTS"); continue; }
  results.set(p.id, { id: p.tool === "createSupplier" ? "sup-1" : "emp-1" });
  console.log(p.id, "EXECUTED");
}
```

## أين يوجد في كودنا

- `packages/ai/src/tools/types.ts` — `AssistantMode` و`ToolRisk` و`WriteTool` وفيه `preview` (لا يكتب) و`execute` (يكتب)، و`defineWriteTool`.
- `packages/ai/src/tools/policy.ts` — `needsApproval`: سطر `if (tool.risk === "high") return true;` هو قاعدة «high يطلب موافقة دائماً». وفيه `refsIn` و`resolveRefs` و`UnresolvedRefError` لسلسلة `$ref`.
- `packages/ai/src/graph/assistant-graph.ts` — عقدة `tools`: تتحقق من المراجع (`UNKNOWN_REFERENCE`)، وتستدعي `tool.preview`، وتنفّذ فوراً فقط إذا `!pendingRef && !needsApproval(...)`، وإلا تبني `ProposedItem` وترد على النموذج بـ `PROPOSED` وتذكّره بصيغة `"$ref:${id}.id"`.
- `packages/ai/src/graph/change-set.ts` — `executeDecisions` و`ItemOutcome` و`outcomesMessage`. الترتيب هو ترتيب الاقتراح، والرفض يسبق فحص الاعتماد، والاعتماد على غير منفّذ يعطي `DEPENDS_ON_UNEXECUTED`. التعديلات من البطاقة تُدمج ثم تُفحص بـ Zod مرة أخرى.
- `apps/api/src/ai/ai-chat.service.ts` — `decide` تحجز القرار ذرّياً: `updateMany({ where: { id, status: "AWAITING_APPROVAL" }, data: { status: "IDLE" } })`، وإن كان `count !== 1` ترمي `NOTHING_TO_DECIDE`. ثم `recordOutcomes`. أما `rejectPending` فتُستخدم في `send` عندما يبدأ المستخدم رسالة جديدة قبل البتّ في الاقتراحات المعلّقة.
- `apps/api/src/ai/ai.controller.ts` — `decide` يتحقق أن كل مفتاح يطابق `^c\d{1,4}$` وأن القيمة `approve` أو `reject` قبل تمريرها.
- `packages/db/prisma/migrations/20261122090000_ai_assistant/migration.sql` — الدالة `ai_change_items_freeze` والمُشغّل `ai_change_items_freeze` قبل أي `UPDATE`: إذا كان `OLD.status <> 'PROPOSED'` يرمي استثناءً. لذلك لا يمكن تعديل صف نهائي، والانتقال المسموح هو من `PROPOSED` فقط.
- `packages/ai/src/graph/assistant-graph.spec.ts` — اختبارات: الاقتراح في `review` لا ينفّذ، و`auto` ينفّذ low ويقترح high، ورفض `c1` يجعل `c2` `skipped`، وتعديل البطاقة يُفحص مرة أخرى.

## جرّب بنفسك

1. في `packages/ai/src/graph/assistant-graph.spec.ts` غيّر `risk: "high"` في أداة `postPayment` إلى `"low"`، ثم شغّل اختبار «auto mode runs low-risk writes at once…». لاحظ أن الدفعة صارت تُنفّذ بدل أن تُقترح. أعدها إلى `"high"`.
2. في `packages/ai/src/tools/policy.ts` اجعل `needsApproval` تعيد `false` دائماً، ثم شغّل نفس الاختبار. لاحظ أن الخطورة العالية نُفّذت بلا موافقة؛ هذا يثبت أن القاعدة في هذا السطر لا في الـ prompt.
3. في `apps/api/src/ai/ai-chat.service.ts` احذف شرط `if (claimed.count !== 1)` (أو غيّر شرط `where` ليصبح `{ id }`)، ثم أرسل قرار الموافقة مرتين بسرعة من نافذتين. لاحظ أن الحماية من النقر المزدوج اختفت وأن العناصر قد تُنفّذ مرتين. أعد الشرط.

## أخطاء شائعة

- **الاعتقاد أن «قبول الكل» يشمل الخطورة العالية:** في كودنا `high` يبقى اقتراحاً يطلب موافقة صريحة في كل وضع، حتى `auto`. أي واجهة تتجاوز ذلك تكسر القاعدة.
- **نسيان `dependsOn`:** إن لم تُسجّل المراجع التي وجدها `refsIn`، فلن يُعرف أن `c2` يعتمد على `c1`، وقد يُنفّذ بقيمة ناقصة أو يفشل بطريقة غامضة.
- **تنفيذ القرار بلا حجز ذرّي:** نقرتان متزامنتان تنفّذان نفس العناصر. الحل هو تحويل الحالة من `AWAITING_APPROVAL` إلى `IDLE` بشرط، ورفض الطلب الثاني.
- **محاولة تعديل صف نهائي:** تحديث صف حالته `EXECUTED` يرمي استثناء من مُشغّل `ai_change_items_freeze`. التصحيح يكون بعملية جديدة، لا بتعديل التاريخ.
- **الظن أن `preview` يكتب:** `preview` للعرض فقط؛ إن كتب فيه شيئاً فستظهر بطاقة «لم تُنفّذ» بينما البيانات تغيّرت بالفعل.
