# الدرس 3 — حالة LangGraph: العقد والحواف الشرطية وحد الخطوات

## الفكرة في 5 أسطر

1. الحالة كائن واحد يمرّ بين العقد؛ كل عقدة تقرأ منه وتعيد الجزء الذي تغيّره فقط.
2. `Annotation.Root` يعرّف كل حقل ومعه `reducer` يحدد كيف تُدمج القيمة الجديدة مع القديمة.
3. عقدة `agent` هي نداء LLM واحد، وعقدة `tools` تنفّذ ما طلبه النموذج من أدوات.
4. الحواف الشرطية تقرّر: هل نذهب إلى `tools` أم إلى `END`؟ وحد الخطوات يمنع الحلقة اللانهائية.
5. الموافقة ليست داخل الرسم: الرسم يقترح فقط، والاقتراح يُحفظ في قاعدة البيانات، والتنفيذ يحدث في طلب آخر.

## التدفق

```text
                    ┌──────────────────────────────┐
                    │  State: messages, proposals, │
                    │  executed, steps, tokens...  │
                    └──────────────┬───────────────┘
                                   │
START ──► agent ──(tool_calls?)──► tools ──┐
            ▲   │ لا                        │
            │   ▼                          │
            │  END                         │
            └──────────────────────────────┘
              (حتى maxSteps = 8 افتراضياً)

بعد انتهاء الرسم:
  proposals ──► ai_change_items (status = PROPOSED)
  conversation.status = AWAITING_APPROVAL
                     │
        المستخدم يقرّر في طلب منفصل
                     ▼
  executeDecisions() ──► كل خدمة core تنفّذ داخل transactionها
                     │
                     ▼
  runTurn جديد يرسل outcomesMessage للنموذج ليلخّص ما حدث
```

## أصغر مثال يعمل

ثبّت: `npm i @langchain/langgraph @langchain/core`. المثال يستخدم نفس واجهات LangGraph المستخدمة في `packages/ai/src/graph/assistant-graph.ts`: `Annotation.Root` مع `reducer`، ثم `StateGraph` و`START` و`END` و`addConditionalEdges`. النموذج مزيّف حتى يعمل المثال بلا مفتاح API.

```ts
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  steps: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
});

// نموذج مزيّف: النداء الأول يطلب أداة، والثاني يجيب نصاً.
function fakeModel(messages: BaseMessage[]): AIMessage {
  const sawTool = messages.some((m) => m.getType() === "tool");
  return sawTool
    ? new AIMessage("الراتب الأساسي 3000.00 ريال.")
    : new AIMessage({ content: "", tool_calls: [{ id: "t1", name: "salary", args: { name: "أسامة" } }] });
}

const graph = new StateGraph(State)
  .addNode("agent", (s) => ({ messages: [fakeModel(s.messages)], steps: 1 }))
  .addNode("tools", (s) => {
    const last = s.messages[s.messages.length - 1] as AIMessage;
    return { messages: last.tool_calls!.map((c) => new ToolMessage({ content: "3000.00", tool_call_id: c.id!, name: c.name })) };
  })
  .addEdge(START, "agent")
  .addConditionalEdges("agent", (s) => ((s.messages[s.messages.length - 1] as AIMessage).tool_calls?.length ? "tools" : END))
  .addConditionalEdges("tools", (s) => (s.steps >= 4 ? END : "agent"))
  .compile();

const out = await graph.invoke({ messages: [new HumanMessage("كم راتب أسامة؟")] }, { recursionLimit: 10 });
console.log(out.messages.map((m) => m.content));
```

## أين يوجد في كودنا

- `packages/ai/src/graph/assistant-graph.ts` — `State` مبني بـ `Annotation.Root`: `messages` و`proposals` و`executed` تُجمع بـ `concat`، و`steps` و`inputTokens` و`outputTokens` تُجمع بالجمع، و`clarified` بـ `a || b`. العقدتان `agent` و`tools`، ثم `new StateGraph(State)` مع `addEdge(START, "agent")` و`addConditionalEdges` على `agent` و`tools`. الحد الافتراضي `maxSteps = 8`، ويُمرَّر `recursionLimit: maxSteps * 2 + 4` إلى `graph.invoke`. النتيجة تحتوي `hitStepLimit` ويُبثّ عنها حدث `step_limit`.
- `packages/ai/src/graph/assistant-graph.ts` — عقدة `tools` تنتهي مبكراً عند `clarified` (سؤال توضيحي) أو عند بلوغ حد الخطوات، وهذا سبب وجود الحافة الشرطية الثانية.
- `packages/ai/src/graph/change-set.ts` — `executeDecisions` تعمل خارج الرسم تماماً. التعليق في أعلى الملف يشرح السبب: «ليست transaction واحدة؛ كل خدمة core تملك transactionها ومعها الترقيم والتدقيق».
- `apps/api/src/ai/ai-chat.service.ts` — `runTurn` يستدعي `runAssistant`، ثم يحفظ `result.proposals` في `aiChangeItem` داخل `$transaction` ويضبط حالة المحادثة إلى `AWAITING_APPROVAL`. وعند `decide` يستدعي `executeDecisions` ثم `runTurn` جديدة لتلخيص النتائج.
- `packages/db/prisma/schema.prisma` — النموذج `AiChangeItem` mapped إلى جدول `ai_change_items`، وفيه `itemKey` و`dependsOn` و`status` و`result`.
- `packages/ai/src/graph/assistant-graph.spec.ts` — اختبار «stops at the step limit» يثبت سلوك `maxSteps`.

**ملاحظة صريحة عن قرار تغيّر:** الخطة في `docs/Planning/ai-assistant-plan.md` (§1.3 و§4.4) اقترحت LangGraph مع Postgres checkpointer و`interrupt()` لوقف الرسم وحفظ حالته. التنفيذ الفعلي استبدل ذلك بما نراه الآن: لا يوجد checkpointer ولا `interrupt` ولا `Command` في `packages/ai`، ولا حالة رسم محفوظة بين الطلبات. الحالة الدائمة هي تاريخ الرسائل في `ai_messages` وصفوف `ai_change_items` وحالة المحادثة `AWAITING_APPROVAL`، والموافقة طلب HTTP منفصل. السبب العملي: كل خدمة core تملك transactionها ولا يصح أن يفتح المساعد transaction حولها، والاقتراح نفسه هو كل ما نحتاج حفظه. الثمن أننا لا نستأنف رسمًا أثناء تنفيذه، لكن نقطة التوقف الوحيدة فعلاً هي انتظار الموافقة، وهي صف في قاعدة البيانات.

## جرّب بنفسك

1. في `packages/ai/src/graph/assistant-graph.ts` غيّر `const maxSteps = opts.maxSteps ?? 8` إلى `?? 1`، ثم اسأل سؤالاً يحتاج أداتين متتاليتين. لاحظ حدث `step_limit` وغياب الإجابة النهائية. أعد القيمة.
2. في نفس الملف غيّر reducer الحقل `messages` إلى `(a, b) => b`. لاحظ أن النموذج يفقد الرسائل السابقة وقد يرفض المزوّد رسالة أداة بلا نداء AI يقابلها. هذا يوضّح لماذا `concat` ضروري.
3. في `packages/ai/src/graph/change-set.ts` احذف فحص `item.dependsOn.some(...)`، ثم ارفض `c1` ووافق على `c2` الذي يستخدم `$ref:c1.id`. لاحظ أن `resolveRefs` سيرمي `UnresolvedRefError` أو سيفشل التحقق، بدل التخطي الآمن. أعد الفحص.

## أخطاء شائعة

- **نسيان `reducer` المناسب:** الافتراضي يستبدل القيمة؛ فتفقد الرسائل أو تنتهي الحلقة عند الخطوة الأولى. `steps` يحتاج الجمع و`messages` يحتاج `concat`.
- **إعادة استخدام الحالة بين محادثات:** إن مرّرت حالة قديمة أو استخدمت كائنًا عامًا، يتسرب سياق مستخدم إلى آخر. في كودنا تُبنى الحالة من تاريخ المحادثة المحفوظ في كل طلب.
- **حلقة بلا حد:** نموذج يكرّر طلب الأدوات يستهلك tokens بلا نهاية. `maxSteps` و`recursionLimit` هما الفرامل، ويظهر ذلك كـ `step_limit`.
- **الخلط بين عدد الخطوات وعدد الأدوات:** `steps` يزيد مرة واحدة في كل نداء `agent`، لا عن كل أداة داخل النداء. لذلك قد ينفّذ النداء الواحد عدة أدوات ويُحسب خطوة واحدة.
- **وضع الموافقة داخل الرسم بلا حالة دائمة:** إن أوقفت الرسم ثم أعدت تشغيل الخادم ضاعت الحالة. لهذا اخترنا حفظ الاقتراحات في `ai_change_items` بدل checkpointer.
