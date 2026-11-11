import { DraftBar } from "../documents/DraftBar";
import { useDocumentDraft } from "../documents/use-document-draft";
import { LineField } from "../../shared/ui/LineField";
import { useState } from "react";
import { CreatedDialog, type CreatedInfo } from "../../shared/ui/CreatedDialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AxiosError } from "axios";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataGrid } from "../../shared/ui/DataGrid";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { z } from "zod";
import { localizedName } from "../../shared/lib/localized-name";
import { formatCalendarDate, toDateOnlyIsoString } from "../../shared/lib/format-date";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useAllItems } from "./use-items";
import { useAllWarehouses } from "./use-warehouses";
import { useRecordStockCount, usePostStockCount, useStockCounts, type StockCountSummary } from "./use-stock-counts";

const lineSchema = z.object({
  itemId: z.string().min(1, "required"),
  countedQuantity: z.string().min(1, "required"),
  unitCostIfNoStock: z.string(),
});

const formSchema = z.object({
  warehouseId: z.string().min(1, "required"),
  documentDate: z.date(),
  lines: z.array(lineSchema).min(1, "atLeastOneLine"),
});
type FormValues = z.infer<typeof formSchema>;

const EMPTY_LINE = { itemId: "", countedQuantity: "", unitCostIfNoStock: "" };

export function StockCountPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: warehouses } = useAllWarehouses();
  const { data: items } = useAllItems();
  const postCount = usePostStockCount();
  const { data: counts, isPending, isError, refetch } = useStockCounts(false);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInfo | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { warehouseId: "", documentDate: new Date(), lines: [EMPTY_LINE] },
  });

  const values = watch();
  const draft = useDocumentDraft("stock_count", values, reset, Boolean(values.warehouseId || values.lines.some((line) => line.itemId || line.countedQuantity)));
  const recordCount = useRecordStockCount(draft.id);
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });

  // A line the auto-new-line-on-Enter feature added but the user never touched — dropped silently
  // right before validation runs, instead of blocking the save button or forcing a manual delete.
  const isBlankLine = (l: FormValues["lines"][number]): boolean => l.itemId === "" && l.countedQuantity.trim() === "" && l.unitCostIfNoStock.trim() === "";
  const submitWithCleanup = (e: React.BaseSyntheticEvent): void => {
    const blankIndexes = watch("lines").reduce<number[]>((acc, l, i) => (isBlankLine(l) ? [...acc, i] : acc), []);
    if (blankIndexes.length > 0) remove(blankIndexes);
    void onSubmit(e);
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!await draft.save()) return;
    recordCount.mutate(
      {
        warehouseId: values.warehouseId,
        documentDate: toDateOnlyIsoString(values.documentDate),
        lines: values.lines.map((line) => ({
          itemId: line.itemId,
          countedQuantity: line.countedQuantity,
          ...(line.unitCostIfNoStock.trim() ? { unitCostIfNoStock: line.unitCostIfNoStock.trim() } : {}),
        })),
      },
      {
        onSuccess: (saved) => {
          void draft.complete();
          const warehouse = warehouses?.find((w) => w.id === values.warehouseId);
          setCreated({
            onOpen: () => void navigate(`/inventory/stock-counts/${saved.id}`),
            title: t("inventory.stockCount.title"),
            headline: saved.number,
            rows: [
              { label: t("created.warehouse"), value: warehouse ? localizedName(warehouse, i18n.language) : "" },
              { label: t("created.date"), value: toDateOnlyIsoString(values.documentDate), ltr: true },
              { label: t("created.lines"), value: String(values.lines.length) },
            ],
          });

        },
      },
    );
  });

  const onPost = (id: string): void => {
    setPostingId(id);
    postCount.mutate(id, { onSettled: () => setPostingId(null) });
  };

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("inventory.stockCount.title")}</h1>
          <p className="erp-page__subtitle">{t("inventory.stockCount.subtitle")}</p>
        </div>
      </div>

      <h2 className="erp-form__section-title">{t("inventory.stockCount.recordNew")}</h2>
      <DraftBar draft={draft} />
      <form onSubmit={(e) => { e.preventDefault(); submitWithCleanup(e); }} noValidate className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="scWarehouse">{t("inventory.warehouses.title")}</label>
            <Controller
              control={control}
              name="warehouseId"
              render={({ field }) => (
                <Dropdown
                  inputId="scWarehouse"
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
            <label htmlFor="scDate">{t("inventory.goodsReceipt.documentDate")}</label>
            <Controller control={control} name="documentDate" render={({ field }) => <Calendar inputId="scDate" value={field.value} onChange={(e) => field.onChange(e.value)} dateFormat="yy-mm-dd" />} />
          </div>
        </div>

        <h3 className="erp-form__section-title">{t("inventory.stockCount.lines")}</h3>
        <p className="erp-field__hint">{t("inventory.stockCount.unitCostHint")}</p>

        <div className="erp-lines">
          {fields.map((field, index) => (
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
              <Controller
                control={control}
                name={`lines.${index}.countedQuantity`}
                render={({ field: f }) => (
                  <LineField label={t("inventory.stockCount.countedQuantity")}><InputText
                    placeholder={t("inventory.stockCount.countedQuantity")}
                    dir="ltr"
                    value={f.value}
                    onChange={f.onChange}
                    className={`erp-lines__amount${errors.lines?.[index]?.countedQuantity ? " p-invalid" : ""}`}
                  /></LineField>
                )}
              />
              <Controller
                control={control}
                name={`lines.${index}.unitCostIfNoStock`}
                render={({ field: f }) => (
                  <LineField label={t("inventory.stockCount.unitCostIfNoStock")}><InputText
                    placeholder={t("inventory.stockCount.unitCostIfNoStock")}
                    dir="ltr"
                    value={f.value}
                    onChange={f.onChange}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && index === fields.length - 1) {
                        e.preventDefault();
                        append(EMPTY_LINE);
                      }
                    }}
                    className="erp-lines__amount"
                  /></LineField>
                )}
              />
              <Button type="button" icon="pi pi-trash" text severity="danger" aria-label={t("actions.removeLine")} onClick={() => remove(index)} disabled={fields.length <= 1} />
            </div>
          ))}
        </div>
        <Button type="button" data-erp-add-line label={t("actions.addLine")} icon="pi pi-plus" text onClick={() => append(EMPTY_LINE)} />

        {errors.lines?.root?.message ? <p className="erp-field__error">{t(`validation.${errors.lines.root.message}`)}</p> : null}
        {recordCount.isError ? (
          <p className="erp-auth-card__error">
            {(() => {
              if (recordCount.error instanceof AxiosError && recordCount.error.response?.status === 400) {
                const msg: string = (recordCount.error.response.data as { message?: string })?.message ?? "";
                if (msg.toLowerCase().includes("unit cost")) return t("inventory.stockCount.unitCostRequired");
                if (msg.toLowerCase().includes("open") && msg.toLowerCase().includes("period")) return t("inventory.stockCount.noOpenPeriod");
              }
              return t("inventory.stockCount.recordError");
            })()}
          </p>
        ) : null}
        {postCount.isError ? <p className="erp-auth-card__error">{t("inventory.stockCount.postError")}</p> : null}
        {recordCount.isSuccess ? <p className="erp-field__hint">{t("inventory.stockCount.recordedSuccess", { number: recordCount.data?.number })}</p> : null}

        <div className="erp-form__actions">
          <Button type="submit" label={t("inventory.stockCount.record")} loading={recordCount.isPending} disabled={!draft.ready || draft.status === "completed"} />
        </div>
      </form>

      <h2 className="erp-form__section-title">{t("inventory.stockCount.recent")}</h2>
      {isPending ? (
        <PageSkeleton />
      ) : isError ? (
        <div className="erp-page">
          <p className="erp-page__error">{t("status.error")}</p>
          <button type="button" className="erp-button-link" onClick={() => void refetch()}>
            {t("actions.retry")}
          </button>
        </div>
      ) : (
        <DataGrid value={counts ?? []} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
          <Column field="number" header={t("inventory.stockCount.number")} style={{ width: "10rem" }} body={(row: StockCountSummary) => <button type="button" className="erp-button-link coa-code" onClick={() => void navigate(`/inventory/stock-counts/${row.id}`)}>{row.number}</button>} />
          <Column header={t("inventory.stockLevels.warehouse")} body={(row: StockCountSummary) => localizedName({ name: row.warehouseName, nameAr: row.warehouseNameAr }, i18n.language)} />
          <Column header={t("inventory.goodsReceipt.documentDate")} body={(row: StockCountSummary) => formatCalendarDate(row.documentDate, i18n.language)} />
          <Column header={t("inventory.stockCount.lineCount")} align="right" body={(row: StockCountSummary) => row.lineCount} />
          <Column
            header={t("inventory.stockCount.status")}
            style={{ width: "8rem" }}
            body={(row: StockCountSummary) => <Tag value={row.isPosted ? t("inventory.stockCount.posted") : t("inventory.stockCount.draft")} severity={row.isPosted ? "success" : "warning"} />}
          />
          <Column
            header=""
            style={{ width: "8rem" }}
            body={(row: StockCountSummary) =>
              row.isPosted ? null : (
                <Button label={t("inventory.stockCount.post")} size="small" text onClick={() => onPost(row.id)} loading={postingId === row.id && postCount.isPending} />
              )
            }
          />
        </DataGrid>
      )}
      <CreatedDialog info={created} onHide={() => { if (created?.onOpen) created.onOpen(); }} />
    </div>
  );
}
