import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { z } from "zod";
import { localizedName } from "../../shared/lib/localized-name";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { useAllItems } from "./use-items";
import { useAllWarehouses } from "./use-warehouses";
import { useCreateStockIssue } from "./use-stock-issues";

const lineSchema = z.object({
  itemId: z.string().min(1, "required"),
  quantity: z.string().min(1, "required"),
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
  const { data: warehouses } = useAllWarehouses();
  const { data: items } = useAllItems();
  const createIssue = useCreateStockIssue();

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { warehouseId: "", costCenterRef: "", documentDate: new Date(), lines: [EMPTY_LINE] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });

  const onSubmit = handleSubmit((values) => {
    createIssue.mutate(
      { warehouseId: values.warehouseId, costCenterRef: values.costCenterRef.trim(), documentDate: toDateOnlyIsoString(values.documentDate), lines: values.lines },
      {
        onSuccess: () => reset({ warehouseId: values.warehouseId, costCenterRef: "", documentDate: new Date(), lines: [EMPTY_LINE] }),
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

      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
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
              <InputText placeholder={t("inventory.goodsReceipt.quantity")} dir="ltr" {...register(`lines.${index}.quantity`)} className={`erp-lines__amount${errors.lines?.[index]?.quantity ? " p-invalid" : ""}`} />
              <Button type="button" icon="pi pi-trash" text severity="danger" aria-label={t("actions.removeLine")} onClick={() => remove(index)} disabled={fields.length <= 1} />
            </div>
          ))}
        </div>
        <Button type="button" data-erp-add-line label={t("actions.addLine")} icon="pi pi-plus" text onClick={() => append(EMPTY_LINE)} />

        {errors.lines?.root?.message ? <p className="erp-field__error">{t(`validation.${errors.lines.root.message}`)}</p> : null}
        {createIssue.isError ? <p className="erp-auth-card__error">{insufficientStockMessage ?? t("inventory.stockIssue.postError")}</p> : null}
        {createIssue.isSuccess ? <p className="erp-field__hint">{t("inventory.stockIssue.postedSuccess", { number: createIssue.data?.number })}</p> : null}

        <div className="erp-form__actions">
          <Button type="submit" label={t("inventory.stockIssue.submit")} loading={createIssue.isPending} />
        </div>
      </form>
    </div>
  );
}
