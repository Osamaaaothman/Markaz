# برومبت Claude Design — تصميم "الأورب" للمساعد الذكي في مركز

## طريقة الاستخدام (لأسامة)

1. افتح Claude Design وابدأ مشروعاً جديداً.
2. **أرفق هذه الملفات الثلاثة** من نفس المجلد `docs/Planning/design/assistant-orb/`:
   - `markaz-mark.svg` — شعار مركز الرسمي.
   - `orb-reference.html` — صفحة مرجعية: ألوان الهوية، الحالات السبع متحركة (النسخة الحالية v1)، وأين يظهر الأورب وبأي حجم.
   - لقطة شاشة لصفحة المساعد الحالية (خذها أنت من `/assistant`) — اختياري لكنه مفيد.
3. انسخ **البرومبت الإنجليزي** بالأسفل كما هو حرفياً والصقه في الرسالة الأولى.
4. بعد ما يعطيك الاتجاهات الثلاثة، اختر واحداً، ثم أرسل له **رسالة المتابعة** (بالأسفل أيضاً).
5. لما يخلص، اطلب منه تصدير الكود، وأعطني الملف — أدمجه أنا في `apps/web/src/features/ai/components/AssistantOrb.tsx` بدون تغيير الواجهة البرمجية.

---

## البرومبت (انسخه حرفياً)

```text
I need you to design the animated face ("orb") of an AI assistant inside Markaz, an Arabic/English accounting ERP for companies in Saudi Arabia and the Gulf. I attached the official Markaz emblem (markaz-mark.svg) and a reference page (orb-reference.html) that shows the brand colours, the seven states with our current v1 animation, and every place the orb appears with its size.

WHAT THE ORB IS
A small living mark that tells the user, at a glance, what the assistant is doing. It replaces a generic "AI blob". It must feel like it belongs to Markaz and to a serious finance product: calm, precise, confident, a little delightful — never toy-like, never "sci-fi AI".

BRAND (must follow)
- Emblem: four corner brackets framing a brass centre square. "Markaz" means "centre". The orb must be clearly derived from this emblem (brackets + centre), so the user recognises the brand even at 20px.
- Colours, flat only: green #1C5A40 (tile / primary), cream #ECE9E1 (brackets), brass #C9AA5C (centre). Status colours for success / warning / danger come from the app (use CSS variables: --mk-success, --mk-warning, --mk-danger, with fallbacks #1f8a5b, #c98a12, #c2413b).
- NO colour gradients, no rainbow/aurora/glow-blob "AI look", no glassmorphism. Soft shadow is fine. Motion and shape carry the personality, not colour effects.
- Works on light and dark backgrounds. Do not hard-code a page background around it.
- The existing loading animation of the logo: brackets draw in, the centre square pops, a light shine passes over the tile. Reuse this language.

THE SEVEN STATES (all required, each must be distinguishable at 22px in under a second)
1. idle — ready, nothing running. Calm, present. Very subtle life (e.g. the centre breathes). Must not distract while the user reads.
2. thinking — request sent; the model is reasoning or querying the books. "Working, don't worry." Continuous loop.
3. speaking — the answer is streaming in as text. Rhythmic, voice-like, faster than thinking.
4. listening — voice dictation (microphone) is on. Live, responsive; ideally reacts to an audio level value 0..1 if one is provided.
5. waiting — the assistant proposed changes (e.g. "create customer X") that need the user's approval. Attention needed, but NOT an error. Brass is the natural colour here.
6. success — a change was saved. A short confirmation flash (~1.2–1.6s), then it returns to idle by itself.
7. error — a provider/network/tool error. Short (~1.2–1.6s), clear, not alarming, then back to idle.

TRANSITIONS
Design how it moves BETWEEN states, not only the loops: idle→thinking (start), thinking→speaking (first words arrive), speaking→idle (done), thinking→waiting (proposals ready), waiting→success (user approved), any→error. Transitions should be 200–450ms, with no jump cuts.

INTERACTIVITY (this is important — v1 is not interactive)
- Hover: it notices the pointer (e.g. brackets lean or open slightly toward the cursor, centre brightens).
- Press/click: a small tactile response (squish / bracket snap).
- Pointer tracking on the large hero size: subtle parallax or the centre "looking" toward the cursor.
- Keyboard focus: a clear focus state.
- Optional: in listening state, react to an audioLevel prop.

SIZES AND PLACES (see the reference page)
- 20–22px: top-bar button next to the label "Assistant".
- 26–30px: avatar next to each assistant message.
- 34px: header of the assistant side panel, next to the title and a status line.
- 88–120px: hero on the empty welcome screen ("How can I help?").
Each size can simplify detail (fewer elements at 20px, richer at 120px), but the identity and the seven states must stay recognisable at every size.

DIRECTION / LANGUAGE
The app is right-to-left in Arabic and left-to-right in English. A logo does not mirror; but any motion that implies direction (e.g. "reading" sweep) should feel natural in both. Note it if a motion should flip under dir="rtl".

ACCESSIBILITY AND PERFORMANCE
- Respect prefers-reduced-motion: show a static but still distinguishable version of each state (shape/colour change instead of motion).
- Animate only transform and opacity (60fps on a mid laptop); no filters/blur on many elements; keep DOM under ~40 elements per orb.
- Each state should also have an accessible label (role="img" aria-label) provided by the caller.

WHAT I WANT FROM YOU
Step 1 — Explore: show me 3 clearly different directions, each showing all 7 states at 120px and at 22px side by side, and one transition. Name each direction and explain its idea in two lines. Suggested starting points (you can do better):
  A) "Living emblem": the real logo geometry (brackets + centre) animated — brackets breathe, open, rotate, snap.
  B) "Dot matrix": the emblem drawn as a grid of dots (our v1 is a 5×5 attempt; make it far better — richer patterns, smarter at small size, interactive).
  C) "Precision instrument": brackets as calibration marks / viewfinder around the centre, like a measuring tool focusing.
Step 2 — After I pick one, produce the final component.

FINAL DELIVERABLE (after I choose)
- A single React 18 + TypeScript component, no external animation library, plain CSS (a .css file or CSS-in-file), with this exact API so it drops into the app:
    export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "waiting" | "success" | "error";
    export function AssistantOrb(props: { state?: OrbState; size?: number; label?: string; audioLevel?: number; interactive?: boolean }): JSX.Element;
  size is in px; the whole drawing must scale from one value (e.g. font-size + em units, or an SVG viewBox).
- All colours as CSS variables with the brand fallbacks above; no gradients.
- prefers-reduced-motion handled.
- A demo page showing every state at 22 / 34 / 120px on light and dark backgrounds, with buttons to switch states so I can see the transitions.
- A short spec table: per state — duration, easing, loop or one-shot, what moves.
```

---

## رسالة المتابعة (بعد ما تختار اتجاهاً)

```text
I choose direction [A / B / C]. Please:
1. Refine it: make the 22px version crisper and make "waiting" and "thinking" more different from each other at small size.
2. Add the hover, press and pointer-tracking interactions described above, plus the audioLevel reaction for listening.
3. Show all transitions between states in the demo page with a "play sequence" button: idle → thinking → speaking → waiting → success → idle, and idle → thinking → error → idle.
4. Then export the final React + TypeScript component and its CSS with the exact API from my first message, plus the demo page.
```

---

## ملاحظات لي عند الدمج

- الواجهة الحالية تستدعي `<AssistantOrb state={...} size={...} />` في: زر الشريط العلوي (22)، رأس اللوحة (34)، أفاتار الرسائل (30)، شاشة الترحيب (88–120)، صفحة الإعدادات (40).
- الحالة تأتي من `apps/web/src/features/ai/orb-state.ts` (`useOrbState`) — لا تحتاج تغييراً.
- `audioLevel` غير موجود حالياً؛ إن صمّم Claude Design تفاعلاً معه، أضيفه من `AnalyserNode` أثناء الإملاء.
