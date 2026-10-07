import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
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
  const { data: warehouses } = useAllWarehouses();
  const { data: items } = useAllItems();
  const recordCount = useRecordStockCount();
  const postCount = usePostStockCount();
  const { data: counts, isPending, isError, refetch } = useStockCounts(false);
  const [postingId, setPostingId] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { warehouseId: "", documentDate: new Date(), lines: [EMPTY_LINE] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });

  const onSubmit = handleSubmit((values) => {
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
      { onSuccess: () => reset({ warehouseId: values.warehouseId, documentDate: new Date(), lines: [EMPTY_LINE] }) },
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
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
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
                  <Dropdown
                    value={f.value}
                    onChange={(e) => f.onChange(e.value)}
                    options={(items ?? []).map((i) => ({ label: `${i.code} — ${localizedName(i, i18n.language)}`, value: i.id }))}
                    filter
                    placeholder={t("inventory.items.title")}
                    className={errors.lines?.[index]?.itemId ? "p-invalid erp-lines__account" : "erp-lines__account"}
                  />
                )}
              />
              <Controller
                control={control}
                name={`lines.${index}.countedQuantity`}
                render={({ field: f }) => (
                  <InputText
                    placeholder={t("inventory.stockCount.countedQuantity")}
                    dir="ltr"
                    value={f.value}
                    onChange={f.onChange}
                    className={`erp-lines__amount${errors.lines?.[index]?.countedQuantity ? " p-invalid" : ""}`}
                  />
                )}
              />
              <Controller
                control={control}
                name={`lines.${index}.unitCostIfNoStock`}
                render={({ field: f }) => (
                  <InputText placeholder={t("inventory.stockCount.unitCostIfNoStock")} dir="ltr" value={f.value} onChange={f.onChange} className="erp-lines__amount" />
                )}
              />
              <Button type="button" icon="pi pi-trash" text severity="danger" aria-label={t("actions.removeLine")} onClick={() => remove(index)} disabled={fields.length <= 1} />
            </div>
          ))}
        </div>
        <Button type="button" data-erp-add-line label={t("actions.addLine")} icon="pi pi-plus" text onClick={() => append(EMPTY_LINE)} />

        {errors.lines?.root?.message ? <p className="erp-field__error">{t(`validation.${errors.lines.root.message}`)}</p> : null}
        {recordCount.isError ? <p className="erp-auth-card__error">{t("inventory.stockCount.recordError")}</p> : null}
        {recordCount.isSuccess ? <p className="erp-field__hint">{t("inventory.stockCount.recordedSuccess", { number: recordCount.data?.number })}</p> : null}

        <div className="erp-form__actions">
          <Button type="submit" label={t("inventory.stockCount.record")} loading={recordCount.isPending} />
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
        <DataTable value={counts ?? []} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
          <Column field="number" header={t("inventory.stockCount.number")} style={{ width: "10rem" }} body={(row: StockCountSummary) => <span className="coa-code">{row.number}</span>} />
          <Column header={t("inventory.stockLevels.warehouse")} body={(row: StockCountSummary) => row.warehouseName} />
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
        </DataTable>
      )}
    </div>
  );
}
