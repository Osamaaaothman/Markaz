# خطة قسم الأصول الثابتة (Fixed Assets) — خطة تنفيذ كاملة

> **لمن هذا الملف:** للنموذج المنفّذ (Sonnet) ولأسامة. اقرأه كاملاً قبل أول سطر كود.
> **الحالة:** نُفِّذت (2026-11-19). القرارات المعتمدة من أسامة:
> D-FA-1 = C (يومي)، D-FA-2 = A (قسط ثابت فقط)، D-FA-3 = A (سطر لكل أصل)، D-FA-4 = B (حسابات منفصلة؛ حساب الخسارة مستخدم الآن والربح مع البيع لاحقاً)،
> D-FA-5 = A (البيع مؤجل)، D-FA-6 = A (الرسملة اليدوية بالصافي فقط)، D-FA-7 = يومي حتى تاريخ الاستبعاد، D-FA-8 = B (بادئة لكل فئة).
> الإيقاف المؤقت للإهلاك لم يُبنَ (مذكور في Known Gaps في README الوحدة).
> **التاريخ:** 2026-11-17

---

## 0. تعليمات إلزامية للمنفّذ (اقرأها أولاً)

1. اقرأ `CLAUDE.md` ثم هذه الملفات بالترتيب: `docs/02-ARCHITECTURE-RULES.md` §3–§5،
   `docs/04-DATA-MODEL-RULES.md`، `docs/05-ACCOUNTING-INTEGRITY-RULES.md`،
   `docs/07-API-RULES.md`، `docs/08-FRONTEND-I18N-RULES.md`، `docs/10-TESTING-RULES.md`، `docs/11-GIT-WORKFLOW.md`.
2. **النموذج المرجعي للنسخ هو وحدة الرواتب (HR):** نفس النمط بالضبط في:
   - المنطق: `packages/core/src/hr/payroll-run.service.ts` (تشغيل شهري ينشئ قيداً واحداً — مطابق لتشغيل الإهلاك).
   - ربط الحسابات: `packages/core/src/inventory/account-mapping.service.ts` (`ACCOUNT_MAPPING_KEYS`).
   - API: `apps/api/src/hr/` (controller + dto + exports + tokens + module).
   - الواجهة: `apps/web/src/features/hr/` (صفحة قائمة + صفحة تفاصيل + hook).
   - الصلاحيات: migration مثل `packages/db/prisma/migrations/20261116150000_delivery_note_permissions/` + `seed.ts`.
3. **ممنوع مطلقاً:**
   - `float` أو `number` لأي مبلغ — `Decimal(19,4)` في القاعدة و decimal string في الـ API (ADR-0003).
   - أي `UPDATE`/`DELETE` على `journal_entries` — التصحيح بقيد عكسي عبر `IAccountingEngine.reverseEntry`.
   - كتابة قيد أو رقم مستند أو سجل تدقيق مباشرة — فقط عبر العقود الخمسة في `packages/core/src/contracts.ts`.
   - أي نص ظاهر للمستخدم بدون مفتاح ترجمة عربي + إنجليزي.
   - `any` أو `@ts-ignore` بلا سبب مكتوب.
4. كل استدعاء لـ `postEntry` يكون **داخل نفس الـ transaction** مع المستند والترقيم والتدقيق (`tx` parameter).
5. أي شيء غير مؤكد محاسبياً: اكتب `// REVIEW: <السبب>` وأدرجه في التقرير. **لا تخترع قاعدة محاسبية.**
6. فرع واحد لكل مرحلة، commits صغيرة، تشغيل الاختبارات الحقيقية بعد كل وحدة وعرض المخرجات.

---

## 1. النطاق

### 1.1 تنبيه نطاق (يحتاج تأكيد أسامة)
`docs/01-OPEN-DECISIONS.md` §C.5 و `docs/00-PRODUCT-BRIEF.md` §6 يصنّفان الأصول الثابتة **Tier 2**.
مثل الرواتب: يُبنى لأن أسامة طلبه صراحةً، كوحدة **خارج نطاق Tier 1 الرسمي**، بنفس معيار الجودة.
**المهمة 0** في المرحلة 1: تحديث §C.5 بسطر "الأصول الثابتة بُنيت بطلب أسامة بتاريخ ..." (بنفس صياغة سطر الرواتب).

### 1.2 داخل النطاق (الإصدار الأول)
| # | القدرة | الأثر المحاسبي |
|---|---|---|
| 1 | فئات الأصول (سيارات، أثاث، حاسبات، معدات، مبانٍ، أراضٍ...) مع إعدادات افتراضية وحسابات | لا يوجد |
| 2 | سجل الأصول (بطاقة أصل كاملة) بحالات: مسودة ← نشط ← مستهلك بالكامل ← مستبعد | لا يوجد للمسودة |
| 3 | **رسملة الأصل** (تفعيله) من حساب مصدر (بنك/صندوق/مورد/حساب وسيط/أصول تحت التنفيذ) | قيد |
| 4 | **أصل برصيد افتتاحي** (أصل قائم قبل تشغيل النظام مع مجمع إهلاكه) | قيد |
| 5 | **شراء الأصل عبر فاتورة المورد** (نوع سطر جديد `ASSET`) | ضمن قيد الفاتورة |
| 6 | **تشغيل الإهلاك الشهري** (معاينة ← ترحيل) — قسط ثابت، مع تعويض الأشهر الفائتة | قيد واحد للتشغيل |
| 7 | عكس آخر تشغيل إهلاك | قيد عكسي |
| 8 | **استبعاد/شطب أصل** (تلف، فقدان، تخريد) مع ربح/خسارة | قيد |
| 9 | نقل الأصل (موقع/عهدة موظف/مركز تكلفة) — سجل تاريخي | لا يوجد |
| 10 | إيقاف/استئناف الإهلاك مؤقتاً | لا يوجد |
| 11 | التقارير: سجل الأصول، جدول إهلاك الأصل، حركة الأصول حسب الفئة، تقرير مطابقة مع دفتر الأستاذ | — |
| 12 | تصدير PDF/Excel ثنائي اللغة، المرفقات (فواتير، صور، استمارة)، سجل التدقيق | — |
| 13 | ربط بالموظف (عهدة) وبمركز التكلفة وبالمورد | — |

### 1.3 خارج النطاق — يُسجَّل في README تحت **Known Gaps**
- **بيع الأصل لعميل** (يتطلب فاتورة ضريبية ZATCA بضريبة 15%) — موقوف على القرار D-FA-5.
- إعادة التقييم (Revaluation)، الهبوط في القيمة (Impairment)، طرق الإهلاك المتناقص ووحدات الإنتاج (موقوفة على D-FA-2).
- الإضافات الرأسمالية على أصل قائم وتغيير العمر الإنتاجي (مرحلة لاحقة — D-FA-7).
- الجرد الفعلي بالباركود، تقسيم/دمج الأصول، الأصول المؤجرة (IFRS 16)، الإهلاك الضريبي المختلف عن المحاسبي.

---

## 2. قرارات يجب أن يحسمها أسامة (ويُفضَّل مع محاسب) قبل التنفيذ

> لا يبدأ المنفّذ المرحلة المرتبطة بقرار قبل حسمه. التوصية مكتوبة لتسريع القرار.

```
DECISION NEEDED — D-FA-1 قاعدة الشهر الأول للإهلاك
What:     متى يبدأ الإهلاك؟
Options:  A) من الشهر التالي لتاريخ بدء الاستخدام — بسيط، شائع، فرق صغير
          B) شهر كامل إذا بدأ الاستخدام قبل يوم 15 وإلا من الشهر التالي
          C) نسبة وتناسب يومية دقيقة — أدق، أعقد
          Recommendation: B (شائع في السعودية ويقبله المراجعون) مع جعله إعداداً على مستوى الشركة لاحقاً
Blocking: نعم للمرحلة 3
```
```
DECISION NEEDED — D-FA-2 طرق الإهلاك المدعومة
Options:  A) القسط الثابت فقط في الإصدار الأول — Recommendation
          B) القسط الثابت + المتناقص
Blocking: لا (نبدأ بـ A، الحقل method موجود في الجدول للتوسع)
```
```
DECISION NEEDED — D-FA-3 شكل قيد تشغيل الإهلاك
Options:  A) سطر لكل أصل (شفافية كاملة، قيد طويل)
          B) سطر مجمّع لكل (فئة × مركز تكلفة) + تفاصيل كل أصل محفوظة في جدول سطور التشغيل — Recommendation
Blocking: نعم للمرحلة 3
```
```
DECISION NEEDED — D-FA-4 حسابات الأرباح/الخسائر الرأسمالية والرصيد الافتتاحي
What:     مفاتيح ربط جديدة: FIXED_ASSET_DISPOSAL_GAIN (إيراد)، FIXED_ASSET_DISPOSAL_LOSS (مصروف)،
          OPENING_BALANCE_EQUITY (حقوق ملكية — للأصول الافتتاحية)
Options:  A) حساب واحد للربح والخسارة معاً  B) حسابان منفصلان — Recommendation
Blocking: نعم للمرحلتين 2 و 5
```
```
DECISION NEEDED — D-FA-5 بيع الأصل لطرف خارجي
Why:      البيع توريد خاضع لضريبة 15% ويجب إصدار فاتورة ضريبية مسجلة في ZATCA؛ قيد بدون فاتورة = مخالفة.
Options:  A) تأجيل البيع؛ الإصدار الأول يدعم الشطب/التخريد فقط — Recommendation
          B) دعم سطر "أصل ثابت" في فاتورة المبيعات (عمل كبير يلمس وحدة المبيعات وحزمة الامتثال)
Blocking: لا (A هو الافتراضي)
```
```
DECISION NEEDED — D-FA-6 الضريبة عند الرسملة اليدوية
What:     رسملة يدوية من حساب بنك/صندوق — هل نسمح بضريبة مدخلات؟
Options:  A) لا: الرسملة اليدوية بالمبلغ الصافي فقط؛ الشراء الخاضع للضريبة يمر عبر فاتورة المورد — Recommendation
          B) نعم: حقل ضريبة ورمز ضريبي في شاشة الرسملة
Blocking: نعم للمرحلة 2
```
```
DECISION NEEDED — D-FA-7 الإهلاك في شهر الاستبعاد
Options:  A) لا إهلاك لشهر الاستبعاد  B) شهر كامل  C) يومي
          Recommendation: نفس قاعدة D-FA-1 معكوسة (قبل 15 = لا إهلاك، بعده = شهر كامل)
Blocking: نعم للمرحلة 5
```
```
DECISION NEEDED — D-FA-8 ترقيم الأصول
Options:  A) ترقيم واحد للشركة FA-000001 — Recommendation
          B) بادئة لكل فئة VEH-0001
Blocking: نعم للمرحلة 1
```

---

## 3. نموذج البيانات (Prisma) — `packages/db/prisma/schema.prisma`

قواعد عامة: كل جدول له `companyId`، أسماء snake_case عبر `@map`، المبالغ `Decimal(19,4)`،
`@@unique([companyId, number])` للمستندات، العلاقات `onDelete: Restrict`، الجداول المحاسبية insert-only.

### 3.1 `FixedAssetCategory` — `fixed_asset_categories`
| الحقل | النوع | ملاحظة |
|---|---|---|
| id, companyId | String | |
| code | String | فريد للشركة |
| name / nameAr | String | |
| depreciationMethod | String | `STRAIGHT_LINE` فقط حالياً |
| defaultUsefulLifeMonths | Int? | null = لا يُهلك (الأراضي) |
| defaultResidualPercent | Decimal(7,4) | 0–100 |
| isDepreciable | Boolean | false للأراضي والأصول تحت التنفيذ |
| assetAccountId | String | حساب أصل، ترحيلي، normalBalance=DEBIT |
| accumulatedDepreciationAccountId | String? | حساب أصل مقابل (contra)، ترحيلي، normalBalance=CREDIT؛ مطلوب إذا isDepreciable |
| depreciationExpenseAccountId | String? | حساب مصروف ترحيلي؛ مطلوب إذا isDepreciable |
| isActive, createdAt/By, updatedAt/By, version | | |

تحقق في الخدمة: نوع كل حساب صحيح، ترحيلي، فعّال، والحساب المقابل `normalBalance = CREDIT`.
لا يُغيَّر أي حساب في فئة لها أصل نشط (يُرفض برمز `CATEGORY_IN_USE`).

### 3.2 `FixedAsset` — `fixed_assets`
| الحقل | النوع | ملاحظة |
|---|---|---|
| id, companyId, number | String | number من `INumberingService` نوع `FIXED_ASSET` |
| name / nameAr, description | String | |
| categoryId | String | |
| status | String | `DRAFT` / `ACTIVE` / `FULLY_DEPRECIATED` / `DISPOSED` |
| acquisitionDate | Date | |
| inServiceDate | Date | بداية الإهلاك |
| acquisitionCost | Decimal(19,4) | > 0 |
| residualValue | Decimal(19,4) | 0 ≤ ≤ التكلفة |
| usefulLifeMonths | Int? | |
| depreciationMethod | String | نسخة من الفئة لحظة الرسملة |
| openingAccumulatedDepreciation | Decimal(19,4) | للأصل الافتتاحي فقط، وإلا 0 |
| depreciatedThroughMonth | String? | `YYYY-MM` آخر شهر مُهلك (حالة مشتقة، تُحدَّث فقط داخل transaction التشغيل/العكس) |
| accumulatedDepreciation | Decimal(19,4) | مخزّن للأداء، يجب أن يطابق مجموع السطور + الافتتاحي (اختبار مطابقة) |
| isDepreciationPaused | Boolean | |
| currency | String | عملة الشركة الأساسية فقط في الإصدار الأول |
| supplierPartyId, custodianEmployeeId, costCenterId, location, serialNumber, barcode | String? | |
| sourceType | String | `MANUAL` / `OPENING` / `SUPPLIER_INVOICE` |
| sourceAccountId | String? | حساب المصدر في الرسملة اليدوية |
| supplierInvoiceLineId | String? | عند الشراء عبر الفاتورة |
| capitalizationJournalEntryId | String? | |
| disposalId | String? | |
| actorId, correlationId, timestamps, version | | |

فهارس: `[companyId, status]`، `[companyId, categoryId]`، `[companyId, custodianEmployeeId]`.
**قيد قاعدة بيانات (CHECK):** `residual_value >= 0 AND residual_value <= acquisition_cost`، و
`accumulated_depreciation <= acquisition_cost - residual_value`.

### 3.3 `DepreciationRun` — `depreciation_runs` (insert-only إلا حقلي العكس)
id, companyId, number (`DEPRECIATION_RUN`)، periodYear, periodMonth, runDate، totalAmount Decimal،
status `POSTED` / `REVERSED`، journalEntryId، reversalJournalEntryId?، reversalReason?،
actorId, correlationId, createdAt.
`@@unique([companyId, periodYear, periodMonth])` **مع شرط** أن العكس يسمح بإعادة التشغيل:
الأسلم جدول منفصل أو unique جزئي `WHERE status = 'POSTED'` (raw SQL في الـ migration، مثل ما فعلناه سابقاً).

### 3.4 `DepreciationRunLine` — `depreciation_run_lines` (insert-only)
id, runId, assetId, fromMonth, toMonth (للتعويض)، monthsCount، amount،
accumulatedAfter، netBookValueAfter، costCenterId?، isCatchUp Boolean.

### 3.5 `FixedAssetDisposal` — `fixed_asset_disposals` (insert-only)
id, companyId, number (`FIXED_ASSET_DISPOSAL`)، assetId (unique)، disposalDate، disposalType
`SCRAP` / `LOSS` / `WRITE_OFF` (و`SALE` لاحقاً بعد D-FA-5)، costAtDisposal، accumulatedAtDisposal،
finalDepreciationAmount، gainLoss (موجب = ربح)، reason، journalEntryId، actorId, correlationId, createdAt.

### 3.6 `FixedAssetTransfer` — `fixed_asset_transfers` (insert-only)
id, companyId, assetId, transferDate، from/to: location, custodianEmployeeId, costCenterId، reason، actorId, createdAt.

### 3.7 تعديلات على جداول قائمة
- `SupplierInvoiceLine.kind`: إضافة `ASSET`، وحقل `fixedAssetCategoryId String?`.
- `ACCOUNT_MAPPING_KEYS` في `packages/core/src/inventory/account-mapping.service.ts`: إضافة
  `FIXED_ASSET_DISPOSAL_GAIN`، `FIXED_ASSET_DISPOSAL_LOSS`، `OPENING_BALANCE_EQUITY` (حسب D-FA-4)، و
  `FIXED_ASSETS_PARENT` في `GROUP_MAPPING_KEYS` (نوع ASSET) لاقتراح حسابات الفئات.
- أنواع ترقيم جديدة في `DocumentNumberSeries`: `FIXED_ASSET`، `DEPRECIATION_RUN`، `FIXED_ASSET_DISPOSAL`.
- إضافة علاقات عكسية في `Account`, `Employee`, `CostCenter`, `Party`, `JournalEntry`, `Company`.

---

## 4. القيود المحاسبية (المرجع الوحيد — لا تستنتج غيرها)

كل القيود: `sourceModule = "fixed-assets"`، `sourceDocumentType` = اسم المستند، `idempotencyKey` من الطلب.

| العملية | مدين | دائن |
|---|---|---|
| رسملة يدوية | حساب الأصل (الفئة) = التكلفة | حساب المصدر المختار = التكلفة |
| أصل افتتاحي | حساب الأصل = التكلفة | مجمع الإهلاك = الإهلاك المتراكم الافتتاحي؛ `OPENING_BALANCE_EQUITY` = صافي القيمة |
| شراء عبر فاتورة مورد | حساب الأصل = صافي السطر؛ ضريبة المدخلات كالمعتاد | الدائنون (المورد) = الإجمالي |
| تشغيل الإهلاك | مصروف الإهلاك (لكل فئة × مركز تكلفة) | مجمع الإهلاك (لكل فئة) |
| عكس التشغيل | `reverseEntry` على قيد التشغيل | — |
| استبعاد بخسارة | مجمع الإهلاك + `FIXED_ASSET_DISPOSAL_LOSS` | حساب الأصل = التكلفة |
| استبعاد بربح (نادر بدون بيع؛ يُرفض إذا ≠ 0 قبل D-FA-5) | — | — |

**قبل الاستبعاد:** يُحسب إهلاك من آخر شهر مُهلك حتى شهر الاستبعاد (حسب D-FA-7) ويُضاف كسطور
داخل **نفس قيد الاستبعاد** (مدين مصروف / دائن مجمع) — لا قيد منفصل.

### 4.1 خوارزمية القسط الثابت (دالة نقية في `packages/core/src/fixed-assets/depreciation.ts`)
```
depreciableBase   = cost - residual
monthlyAmount     = round4(depreciableBase / usefulLifeMonths)   // ADR-0003 rounding mode
remaining         = depreciableBase - accumulated
amountForMonth    = min(monthlyAmount, remaining)
آخر شهر           = يأخذ "remaining" بالكامل ⇒ صافي القيمة ينتهي بالضبط عند residual
```
- الحساب بـ Decimal فقط (`decimal-sum.util.ts` و نوع Money المشترك).
- عند `remaining == 0` تتحول الحالة إلى `FULLY_DEPRECIATED`.
- أصل افتتاحي: العمر المتبقي = usefulLifeMonths − الأشهر المنقضية؛ القسط = (التكلفة − الخردة − المتراكم الافتتاحي) / العمر المتبقي. `// REVIEW:` يحتاج تأكيد محاسب.
- تقويم الأشهر من `fiscal-period.util.ts` — **لا تحسب الأشهر بـ `Date` الخام** (مناطق زمنية).

### 4.2 قواعد تشغيل الإهلاك
1. التشغيل لشهر P يُرحَّل في الفترة المالية المقابلة لآخر يوم من P؛ الفترة يجب أن تكون OPEN.
2. لا يُسمح بتشغيل P إذا كان هناك شهر سابق له أصول مستحقة إهلاك ولم يُشغَّل؟ **لا** — التعويض بدلاً من ذلك:
   كل أصل يُهلك من `depreciatedThroughMonth + 1` (أو شهر البدء) حتى P، وتُعلَّم السطور `isCatchUp`.
3. لا تشغيل لشهر مستقبلي (P > الشهر الحالي).
4. لا يُشغَّل P مرتين (unique جزئي). العكس مسموح **لآخر تشغيل فقط** وبشرط عدم وجود استبعاد بعده لأصل فيه.
5. القفل: `SELECT ... FOR UPDATE` على صفوف الأصول المشمولة داخل الـ transaction (اقرأ ملاحظة FOR UPDATE في الذاكرة/`feedback_tooling_quirks`) أو advisory lock على (companyId, 'depreciation') — وثّق الاختيار في تعليق.
6. المعاينة (`preview`) تستخدم نفس الدالة ولا تكتب شيئاً — المعاينة والترحيل يجب أن يعطيا نفس الأرقام (اختبار).
7. تشغيل بدون أصول مستحقة يُرفض برمز `NOTHING_TO_DEPRECIATE` (لا قيد صفري).

---

## 5. طبقة الخدمات — `packages/core/src/fixed-assets/`

```
fixed-assets/
  index.ts                         # الواجهة العامة الوحيدة للوحدة
  README.md                        # الجداول المملوكة، التبعيات، Known Gaps
  depreciation.ts                  # دوال نقية: schedule, monthly amount, months between
  depreciation.spec.ts
  asset-category.service.ts
  fixed-asset.service.ts           # create draft, update, capitalize, registerOpening, transfer, pause/resume
  depreciation-run.service.ts      # preview, post, reverse
  disposal.service.ts              # preview, dispose
  fixed-asset-reports.service.ts   # register, schedule, movement, reconciliation
  fixed-asset.errors.ts            # FixedAssetError بأكواد ثابتة
  *.integration.spec.ts
```
كل خدمة تأخذ `IAccountingEngine`, `INumberingService`, `IPermissionService`, `IAuditLogger` بالحقن (انظر `payroll-run.service.ts`).
كل mutation: تحقق صلاحية ← transaction ← ترقيم ← حفظ ← `postEntry(cmd, tx)` ← audit ← commit.
أكواد الأخطاء (ثابتة، تُترجم في الواجهة): `CATEGORY_IN_USE`, `ACCOUNT_INVALID`, `ASSET_NOT_DRAFT`,
`ASSET_NOT_ACTIVE`, `PERIOD_CLOSED`, `RUN_EXISTS`, `RUN_NOT_LATEST`, `NOTHING_TO_DEPRECIATE`,
`FUTURE_PERIOD`, `RESIDUAL_EXCEEDS_COST`, `MAPPING_MISSING`, `DISPOSAL_AFTER_RUN`.

**تكامل فاتورة المورد:** `supplier-invoice.service.ts` يستدعي `fixedAssets.createFromInvoiceLine(..., tx)`
من `fixed-assets/index.ts` فقط (لا استيراد داخلي). السطر من نوع `ASSET` يُرحَّل مدين حساب أصل الفئة، وينشئ أصلاً
بحالة `ACTIVE` لكل سطر (الكمية > 1 ⇒ أصل واحد بالتكلفة الإجمالية + `// REVIEW:` أو N أصول — **اسأل أسامة**).

---

## 6. الـ API — `apps/api/src/fixed-assets/`

| Method | المسار | الصلاحية |
|---|---|---|
| GET/POST | `/fixed-asset-categories` | `fixed_asset_category:read` / `:manage` |
| PATCH | `/fixed-asset-categories/:id` | `fixed_asset_category:manage` |
| GET | `/fixed-assets` (فلترة: status, category, custodian, costCenter, search, pagination) | `fixed_asset:read` |
| GET | `/fixed-assets/:id` (+ schedule + history) | `fixed_asset:read` |
| POST | `/fixed-assets` (مسودة) | `fixed_asset:create` |
| PATCH | `/fixed-assets/:id` (المسودة كاملة؛ النشط: حقول غير مالية فقط) | `fixed_asset:update` |
| DELETE | `/fixed-assets/:id` (المسودة فقط) | `fixed_asset:create` |
| POST | `/fixed-assets/:id/capitalize` | `fixed_asset:capitalize` |
| POST | `/fixed-assets/opening` | `fixed_asset:capitalize` |
| POST | `/fixed-assets/:id/transfer` | `fixed_asset:update` |
| POST | `/fixed-assets/:id/pause` و `/resume` | `fixed_asset:update` |
| POST | `/fixed-assets/:id/dispose/preview` و `/dispose` | `fixed_asset:dispose` |
| GET | `/depreciation-runs`، `/depreciation-runs/:id` | `depreciation_run:read` |
| POST | `/depreciation-runs/preview` و `/depreciation-runs` | `depreciation_run:post` |
| POST | `/depreciation-runs/:id/reverse` (سبب إلزامي) | `depreciation_run:reverse` |
| GET | `/fixed-assets/reports/register?asOf=`، `/movement?from=&to=`، `/reconciliation?asOf=` | `fixed_asset:read` |
| GET | نفس التقارير `/export?format=pdf|xlsx&lang=` | `fixed_asset:read` |

- DTOs بـ class-validator، المبالغ كـ decimal string (انظر `apps/api/src/hr/dto/hr-dtos.ts`).
- كل POST مالي يتطلب header `Idempotency-Key` (نفس نمط الرواتب).
- migration صلاحيات + `seed.ts`: الأدوار `Admin` (كل شيء)، `Accountant` (كل شيء)، دور القراءة (read فقط) — تحقق من أسماء الأدوار الفعلية في `seed.ts`.

---

## 7. الواجهة — `apps/web/src/features/fixed-assets/`

مجموعة جديدة في `apps/web/src/app/layout/NavConfig.ts`: `nav.groups.fixedAssets` (أيقونة `pi pi-building`):
| الصفحة | المسار | المحتوى |
|---|---|---|
| `FixedAssetsPage` | `/fixed-assets` | جدول PrimeReact: الرقم، الاسم، الفئة، الحالة (Tag)، التكلفة، المتراكم، صافي القيمة، العهدة؛ فلاتر؛ زر "أصل جديد" و"أصل افتتاحي" |
| `FixedAssetFormPage` | `/fixed-assets/new`، `/:id/edit` | نموذج المسودة؛ اختيار الفئة يملأ العمر والخردة تلقائياً |
| `FixedAssetDetailPage` | `/fixed-assets/:id` | بطاقة الأصل + تبويبات: البيانات، جدول الإهلاك (الفعلي + المتوقع)، الحركات (نقل/إيقاف)، القيود المرتبطة (روابط)، المرفقات، سجل التدقيق؛ أزرار: رسملة، نقل، إيقاف، استبعاد (حسب الحالة والصلاحية) |
| `CapitalizeDialog` / `OpeningAssetDialog` / `TransferDialog` / `DisposeDialog` | — | كل حوار مالي يعرض **معاينة القيد** قبل التأكيد (مدين/دائن) ونص "لا يمكن التراجع إلا بقيد عكسي" |
| `AssetCategoriesPage` | `/fixed-assets/categories` | CRUD الفئات مع اختيار الحسابات (فلترة حسب النوع) |
| `DepreciationRunsPage` | `/fixed-assets/depreciation-runs` | قائمة التشغيلات + زر "تشغيل إهلاك شهر" ← اختيار الشهر ← معاينة (جدول سطور، تعويض مميّز) ← ترحيل |
| `DepreciationRunDetailPage` | `/fixed-assets/depreciation-runs/:id` | السطور، رابط القيد، زر عكس (آخر تشغيل فقط) |
| `FixedAssetReportsPage` | `/fixed-assets/reports` | سجل الأصول في تاريخ، حركة الأصول، المطابقة مع الأستاذ، أزرار تصدير |

- hooks: `use-fixed-assets.ts`, `use-depreciation-runs.ts`, `use-asset-categories.ts` (نمط `use-hr.ts`).
- إضافة الصفحات في `AppRoutes.tsx` مع `RequirePermission`، وإضافة نوع المستند في `shared/lib/document-path.ts` ليعمل الربط من القيد إلى المستند.
- **الترجمة:** كل المفاتيح تحت `fixedAssets.*` في `locales/ar/common.json` و `locales/en/common.json`، بما فيها أكواد الأخطاء (`fixedAssets.errors.CATEGORY_IN_USE` ...). تحقق بصرياً في RTL و LTR.
- **قيود PrimeReact (من الذاكرة):** Dropdown بقيمة null يعيد كائن الخيار؛ الجداول fixed-layout فـ min-width على الخلايا يُتجاهل؛ التخصيص بـ CSS فيزيائي لا منطقي. لا Tailwind/Radix.
- المبالغ تُعرض بمنسّق المال المشترك، لا `toFixed` على number.
- إضافة خطوة اختيارية في `setup-status.service.ts`: "فئات الأصول" (غير إلزامية).
- إضافة نوع سطر "أصل ثابت" في شاشة فاتورة المورد (اختيار الفئة بدل الحساب).

---

## 8. التقارير

1. **سجل الأصول في تاريخ X:** لكل أصل: التكلفة، المتراكم حتى X، صافي القيمة، الحالة في X. المجاميع حسب الفئة.
2. **جدول الإهلاك للأصل:** الأشهر المُرحّلة (من سطور التشغيل) + المتوقعة (من الدالة النقية) حتى نهاية العمر.
3. **حركة الأصول (إيضاح القوائم المالية) لفترة:** لكل فئة: رصيد أول المدة، إضافات، استبعادات، رصيد آخر المدة (للتكلفة)،
   ونفس الشيء لمجمع الإهلاك، ثم صافي القيمة.
4. **المطابقة مع الأستاذ العام** (`docs/05` §7): لكل فئة: مجموع التكلفة في السجل مقابل رصيد حساب الأصل في الأستاذ،
   ومجموع المتراكم مقابل رصيد حساب المجمع. أي فرق يظهر باللون الأحمر مع السبب المحتمل (قيد يدوي على حساب الأصل).
   **هذا التقرير هو أداة الاختبار الأساسية** — يُستدعى في نهاية كل integration test.

الصادرات: اتبع `apps/api/src/accounting/exports/report-document.util.ts` و `localize-account-names.ts`.

---

## 9. الاختبارات (`docs/10-TESTING-RULES.md`)

### وحدة (دوال نقية) — `depreciation.spec.ts`
- قسط ثابت: 12,000 / 60 شهر = 200.0000؛ آخر شهر يغلق الفرق بالضبط (مثلاً 10,000 / 36 = 277.7778 ×35 + 277.7770).
- صافي القيمة لا ينزل تحت الخردة أبداً (property test على 1,000 مدخل عشوائي بـ Decimal).
- الأرض (isDepreciable=false) = صفر دائماً.
- قاعدة الشهر الأول (D-FA-1) وشهر الاستبعاد (D-FA-7) — حالات الحدود: يوم 1، 14، 15، 16، آخر الشهر، فبراير، سنة كبيسة.
- أصل افتتاحي بعمر متبقٍ.

### تكامل (قاعدة بيانات حقيقية — اتبع إعداد بيئة الاختبار في `feedback_tooling_quirks`)
1. فئة ← مسودة ← رسملة ⇒ قيد متوازن بالحسابات الصحيحة، رقم مستند، سجل تدقيق، الحالة ACTIVE.
2. تشغيل إهلاك شهر ⇒ قيد واحد متوازن؛ تحديث `depreciatedThroughMonth` و `accumulatedDepreciation`؛ المطابقة = صفر فرق.
3. تشغيل نفس الشهر مرة ثانية ⇒ `RUN_EXISTS`. نفس `Idempotency-Key` ⇒ نفس النتيجة بلا قيد ثانٍ.
4. أصل رُسمل بتاريخ قديم ⇒ التشغيل التالي يعوّض الأشهر (`isCatchUp`).
5. عكس آخر تشغيل ⇒ قيد عكسي، إرجاع حالة الأصول، يمكن إعادة التشغيل. عكس تشغيل غير الأخير ⇒ `RUN_NOT_LATEST`.
6. فترة مغلقة ⇒ رفض الرسملة/التشغيل/الاستبعاد.
7. استبعاد ⇒ إهلاك جزئي + إقفال التكلفة والمجمع + خسارة؛ الأصل DISPOSED؛ لا يدخل التشغيلات اللاحقة.
8. فاتورة مورد بسطر ASSET ⇒ قيد الفاتورة يحمّل حساب الأصل، وينشأ أصل مرتبط.
9. أصل حتى نهاية العمر ⇒ FULLY_DEPRECIATED وصافي القيمة = الخردة بالضبط.
10. **تزامن:** تشغيلان متزامنان لنفس الشهر ⇒ واحد ينجح فقط.
11. محاولة تعديل حقل مالي لأصل ACTIVE ⇒ رفض.
12. كل اختبار ينتهي بـ: ميزان المراجعة متوازن + تقرير المطابقة بلا فروقات.

### واجهة
- اختبارات المكونات الموجودة بنفس النمط؛ فحص أن كل مفتاح ترجمة موجود في الملفين (يوجد سكربت/اختبار؟ تحقق، وإلا أضف اختباراً بسيطاً).
- تحقق يدوي عبر preview: العربية RTL والإنجليزية LTR، الجوال 375px.

---

## 10. مراحل التنفيذ (فرع لكل مرحلة، دمج قبل التالية)

| المرحلة | الفرع | المحتوى | يعتمد على قرار |
|---|---|---|---|
| **1** | `feat/fixed-assets-foundation` | تحديث §C.5؛ schema + migration للجداول 3.1–3.6؛ الصلاحيات؛ أنواع الترقيم؛ مفاتيح الربط؛ `depreciation.ts` + اختباراته؛ خدمة الفئات + API + صفحة الفئات؛ README الوحدة | D-FA-4, D-FA-8 |
| **2** | `feat/fixed-assets-register` | خدمة الأصل: مسودة/تعديل/حذف/رسملة/افتتاحي/نقل/إيقاف؛ API؛ صفحات القائمة والنموذج والتفاصيل وحوارات الرسملة والنقل؛ المرفقات والتدقيق | D-FA-6 |
| **3** | `feat/fixed-assets-depreciation` | خدمة التشغيل (معاينة/ترحيل/عكس) + القفل؛ API؛ صفحات التشغيلات؛ تبويب جدول الإهلاك | D-FA-1, D-FA-3 |
| **4** | `feat/fixed-assets-supplier-invoice` | نوع سطر ASSET في فاتورة المورد (core + api + web) | سؤال الكمية > 1 |
| **5** | `feat/fixed-assets-disposal` | خدمة الاستبعاد + الحوار مع معاينة القيد | D-FA-7 |
| **6** | `feat/fixed-assets-reports` | التقارير الأربعة + التصدير PDF/Excel + خطوة الإعداد + بطاقة لوحة التحكم (اختيارية) | — |
| **7** | `chore/fixed-assets-hardening` | مراجعة شاملة بقائمة §4 من `02-ARCHITECTURE-RULES.md`، اختبار شامل، تحقق RTL/LTR، CHANGELOG، تحديث `14-MILESTONES.md` | — |

**تعريف "منتهٍ" لكل مرحلة:**
- [ ] `npm run typecheck`، `lint`، الاختبارات كاملة — مخرجات حقيقية معروضة.
- [ ] ميزان المراجعة متوازن وتقرير المطابقة صفر في كل integration test.
- [ ] كل نص ظاهر بمفتاح AR + EN، ومجرّب بصرياً في الاتجاهين.
- [ ] README الوحدة محدّث (الجداول، التبعيات، Known Gaps).
- [ ] كل `// REVIEW:` مُدرج في تقرير المرحلة.
- [ ] حزمة الملكية (CLAUDE.md §5): ماذا بُني ولماذا، 5 أسئلة فهم، نقاط الضعف.

---

## 11. أسئلة الفهم التي يجب أن يجيب عنها أسامة بعد الانتهاء (مسودة)
1. لماذا مجمع الإهلاك حساب من نوع ASSET لكن رصيده الطبيعي دائن؟
2. ماذا يحدث لو شُغّل إهلاك نوفمبر بعد أن أُغلقت فترة نوفمبر؟ وأين يُفرض ذلك؟
3. أصل رُسمل اليوم بتاريخ استخدام قبل 4 أشهر — كيف يظهر في التشغيل القادم؟ ولماذا لا يُعدَّل قيد قديم؟
4. شخص سجّل قيداً يدوياً على حساب "السيارات" — أين ستراه، ولماذا هو مشكلة؟
5. لماذا لا نسمح ببيع الأصل لعميل من شاشة الاستبعاد في الإصدار الأول؟

## 12. نقاط ضعف متوقعة (صراحةً)
- القيمة المخزنة `accumulatedDepreciation` تكرار لبيانات مشتقة — خطر عدم تطابق؛ يحميه اختبار المطابقة فقط.
- القيود اليدوية على حسابات الأصول تكسر المطابقة؛ الحل الأقوى (منع الترحيل اليدوي على الحسابات المرتبطة بفئة) قرار منفصل.
- قاعدة الشهر الأول/الأخير والعمر المتبقي للأصل الافتتاحي **قرارات محاسبية يجب أن يراجعها محاسب**، ليست قرارات تقنية.
- عملة واحدة فقط؛ أصل مشترى بالدولار يُسجّل بالريال بسعر الفاتورة.
- لا يوجد إهلاك ضريبي منفصل (زكاة/ضريبة دخل للمنشآت الأجنبية) — قد يُطلب لاحقاً.
