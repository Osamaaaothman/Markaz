import { useDocumentDraft } from "../documents/use-document-draft";
import { DraftBar } from "../documents/DraftBar";
import { StockHint } from "./StockHint";
import { LineField } from "../../shared/ui/LineField";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { z } from "zod";
import { localizedName } from "../../shared/lib/localized-name";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { CreatedDialog, type CreatedInfo } from "../../shared/ui/CreatedDialog";
import { useAllItems } from "./use-items";
import { useAllWarehouses } from "./use-warehouses";
import { useCreateStockIssue } from "./use-stock-issues";
import { useStockLevels } from "./use-stock-levels";
import { stockAvailability } from "./stock-availability";

const lineSchema = z.object({
  itemId: z.string().min(1, "required"),
  quantity: z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, "required").refine((v) => /[1-9]/.test(v), "required"),
});

const formSchema = z.object({
  warehouseId: z.string().min(1, "required"),
  costCenterRef: z.string().trim().min(1, "required"),
  documentDate: z.date(),
  lines: z.array(lineSchema).min(1, "atLeastOneLine"),
});
type FormValues = z.infer<typeof formSchema>;

const EMPTY_LINE = { itemId: "", quantity: "" };

export function StockIssuePage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: warehouses } = useAllWarehouses();
  const { data: items } = useAllItems();
  const [created, setCreated] = useState<CreatedInfo | null>(null);

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { warehouseId: "", costCenterRef: "", documentDate: new Date(), lines: [EMPTY_LINE] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const draftValues = watch();
  const draft = useDocumentDraft("stock_issue", draftValues, (saved) => reset(saved), isDirty || draftValues.lines.some((l) => l.itemId !== ""));
  const createIssue = useCreateStockIssue(draft.id);
  const selectedWarehouseId = watch("warehouseId") || null;
  const stockQuery = useStockLevels({ warehouseId: selectedWarehouseId, belowReorderOnly: false });
  const stockLevels = stockQuery.isError ? undefined : stockQuery.data;
  const availability = stockAvailability(watch("lines").map((l) => ({ ...l, warehouseId: selectedWarehouseId ?? "" })), stockLevels);
  const stockBlocked = availability.some((s) => s.exceeded) || !stockLevels;

  // A line the auto-new-line-on-Enter feature added but the user never touched — dropped silently
  // right before validation runs, instead of blocking the save button or forcing a manual delete.
  const isBlankLine = (l: FormValues["lines"][number]): boolean => l.itemId === "" && l.quantity.trim() === "";
  const submitWithCleanup = (e: React.BaseSyntheticEvent): void => {
    const blankIndexes = watch("lines").reduce<number[]>((acc, l, i) => (isBlankLine(l) ? [...acc, i] : acc), []);
    if (blankIndexes.length > 0) remove(blankIndexes);
    void onSubmit(e);
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!draft.ready || !await draft.save()) return;
    if (stockBlocked) return;
    createIssue.mutate(
      { warehouseId: values.warehouseId, costCenterRef: values.costCenterRef.trim(), documentDate: toDateOnlyIsoString(values.documentDate), lines: values.lines },
      {
        onSuccess: (saved) => {
          void draft.complete();
          const warehouse = warehouses?.find((w) => w.id === values.warehouseId);
          setCreated({
            onOpen: () => void navigate(`/inventory/stock-issues/${saved.id}`),
            title: t("inventory.stockIssue.title"),
            headline: saved.number,
            rows: [
              { label: t("created.warehouse"), value: warehouse ? localizedName(warehouse, i18n.language) : "" },
              { label: t("created.date"), value: toDateOnlyIsoString(values.documentDate), ltr: true },
              { label: t("created.reference"), value: values.costCenterRef.trim() },
              { label: t("created.lines"), value: String(values.lines.length) },
            ],
          });
          reset({ warehouseId: values.warehouseId, costCenterRef: "", documentDate: new Date(), lines: [EMPTY_LINE] });
        },
      },
    );
  });

  // 422/400 from the API carries a specific, already-translated-at-source English message
  // (e.g. "Cannot issue 1000 — only 15 on hand"); shown as-is rather than mapped to one of the
  // generic i18n error keys, since it names the exact numbers involved.
  const insufficientStockMessage = (createIssue.error as { response?: { data?: { message?: string } } } | undefined)?.response?.data
    ?.message;

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("inventory.stockIssue.title")}</h1>
          <p className="erp-page__subtitle">{t("inventory.stockIssue.subtitle")}</p>
        </div>
      </div>

      <DraftBar draft={draft} />
      <form onSubmit={(e) => { e.preventDefault(); submitWithCleanup(e); }} noValidate className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="siWarehouse">{t("inventory.warehouses.title")}</label>
            <Controller
              control={control}
              name="warehouseId"
              render={({ field }) => (
                <Dropdown
                  inputId="siWarehouse"
                  value={field.value}
                  onChange={(e) => field.onChange(e.value)}
                  options={(warehouses ?? []).map((w) => ({ label: localizedName(w, i18n.language), value: w.id }))}
                  className={errors.warehouseId ? "p-invalid" : ""}
                  filter
                />
              )}
            />
          </div>
          <div className="erp-field">
            <label htmlFor="siDate">{t("inventory.goodsReceipt.documentDate")}</label>
            <Controller control={control} name="documentDate" render={({ field }) => <Calendar inputId="siDate" value={field.value} onChange={(e) => field.onChange(e.value)} dateFormat="yy-mm-dd" />} />
          </div>
        </div>

        <div className="erp-field">
          <label htmlFor="siCostCenter">{t("inventory.stockIssue.costCenterRef")}</label>
          <InputText id="siCostCenter" {...register("costCenterRef")} className={errors.costCenterRef ? "p-invalid" : ""} placeholder={t("inventory.stockIssue.costCenterPlaceholder")} />
          {errors.costCenterRef ? <small className="erp-field__error">{t("validation.required")}</small> : null}
        </div>

        <h3 className="erp-form__section-title">{t("inventory.goodsReceipt.lines")}</h3>

        <div className="erp-lines">
          {fields.map((field, index) => {
            const stock = availability[index]!;
            return (
            <div key={field.id} className="erp-lines__row">
              <Controller
                control={control}
                name={`lines.${index}.itemId`}
                render={({ field: f }) => (
                  <LineField label={t("inventory.items.title")}><Dropdown
                    value={f.value}
                    onChange={(e) => f.onChange(e.value)}
                    options={(items ?? []).map((i) => ({ label: `${i.code} — ${localizedName(i, i18n.language)}`, value: i.id }))}
                    filter
                    placeholder={t("inventory.items.title")}
                    className={errors.lines?.[index]?.itemId ? "p-invalid erp-lines__account" : "erp-lines__account"}
                  /></LineField>
                )}
              />
              <div style={{ flex: "1 1 6rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                <LineField label={t("inventory.goodsReceipt.quantity")} hint={<StockHint {...stock} />}><InputText
                  placeholder={t("inventory.goodsReceipt.quantity")}
                  dir="ltr"
                  {...register(`lines.${index}.quantity`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && index === fields.length - 1) {
                      e.preventDefault();
                      append(EMPTY_LINE);
                    }
                  }}
                  className={`erp-lines__amount${errors.lines?.[index]?.quantity ? " p-invalid" : ""}`}
                  style={{ width: "100%" }}
                /></LineField>
              </div>
              <Button type="button" icon="pi pi-trash" text severity="danger" aria-label={t("actions.removeLine")} onClick={() => remove(index)} disabled={fields.length <= 1} />
            </div>
            );
          })}
        </div>
        <Button type="button" data-erp-add-line label={t("actions.addLine")} icon="pi pi-plus" text onClick={() => append(EMPTY_LINE)} />

        {errors.lines?.root?.message ? <p className="erp-field__error">{t(`validation.${errors.lines.root.message}`)}</p> : null}
        {createIssue.isError ? <p className="erp-auth-card__error">{insufficientStockMessage ?? t("inventory.stockIssue.postError")}</p> : null}
        {createIssue.isSuccess ? <p className="erp-field__hint">{t("inventory.stockIssue.postedSuccess", { number: createIssue.data?.number })}</p> : null}

        <div className="erp-form__actions">
          <Button type="submit" label={t("inventory.stockIssue.submit")} disabled={stockBlocked || !draft.ready || draft.status === "completed"} loading={createIssue.isPending} />
        </div>
      </form>
      <CreatedDialog info={created} onHide={() => void navigate("/inventory/stock-issues")} />
    </div>
  );
}
