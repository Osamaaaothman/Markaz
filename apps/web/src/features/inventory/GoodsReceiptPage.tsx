import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { z } from "zod";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { PartyPicker } from "../accounting/PartyPicker";
import { useAllItems } from "./use-items";
import { useAllWarehouses } from "./use-warehouses";
import { useCreateGoodsReceipt } from "./use-goods-receipts";
import { Money } from "@erp/shared";

const lineSchema = z.object({
  itemId: z.string().min(1, "required"),
  quantity: z.string().min(1, "required"),
  unitCost: z.string().min(1, "required"),
});

const formSchema = z.object({
  warehouseId: z.string().min(1, "required"),
  partyId: z.string().nullable(),
  documentDate: z.date(),
  reference: z.string(),
  lines: z.array(lineSchema).min(1, "atLeastOneLine"),
});
type FormValues = z.infer<typeof formSchema>;

const EMPTY_LINE = { itemId: "", quantity: "", unitCost: "" };

export function GoodsReceiptPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: warehouses } = useAllWarehouses();
  const { data: items } = useAllItems();
  const createReceipt = useCreateGoodsReceipt();

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { warehouseId: "", partyId: null, documentDate: new Date(), reference: "", lines: [EMPTY_LINE] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const lines = watch("lines");

  const total = lines.reduce((sum, line) => {
    try {
      if (line.quantity && line.unitCost) {
        return sum.add(Money.of(line.quantity, currency).multiply(line.unitCost).round(4));
      }
    } catch {
      /* invalid amount — surfaced by field-level validation instead */
    }
    return sum;
  }, Money.zero(currency));

  const onSubmit = handleSubmit((values) => {
    createReceipt.mutate(
      {
        warehouseId: values.warehouseId,
        ...(values.partyId ? { partyId: values.partyId } : {}),
        documentDate: toDateOnlyIsoString(values.documentDate),
        ...(values.reference.trim() ? { reference: values.reference.trim() } : {}),
        lines: values.lines,
      },
      {
        onSuccess: () => reset({ warehouseId: values.warehouseId, partyId: null, documentDate: new Date(), reference: "", lines: [EMPTY_LINE] }),
      },
    );
  });

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("inventory.goodsReceipt.title")}</h1>
          <p className="erp-page__subtitle">{t("inventory.goodsReceipt.subtitle")}</p>
        </div>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="grWarehouse">{t("inventory.warehouses.title")}</label>
            <Controller
              control={control}
              name="warehouseId"
              render={({ field }) => (
                <Dropdown
                  inputId="grWarehouse"
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
            <label htmlFor="grDate">{t("inventory.goodsReceipt.documentDate")}</label>
            <Controller
              control={control}
              name="documentDate"
              render={({ field }) => <Calendar inputId="grDate" value={field.value} onChange={(e) => field.onChange(e.value)} dateFormat="yy-mm-dd" />}
            />
          </div>
        </div>

        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="grParty">{t("inventory.goodsReceipt.supplier")}</label>
            <Controller control={control} name="partyId" render={({ field }) => <PartyPicker inputId="grParty" value={field.value} onChange={(party) => field.onChange(party?.id ?? null)} />} />
          </div>
          <div className="erp-field">
            <label htmlFor="grReference">{t("inventory.goodsReceipt.reference")}</label>
            <InputText id="grReference" {...register("reference")} />
          </div>
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
              <InputText placeholder={t("inventory.goodsReceipt.unitCost")} dir="ltr" {...register(`lines.${index}.unitCost`)} className={`erp-lines__amount${errors.lines?.[index]?.unitCost ? " p-invalid" : ""}`} />
              <Button type="button" icon="pi pi-trash" text severity="danger" aria-label={t("actions.removeLine")} onClick={() => remove(index)} disabled={fields.length <= 1} />
            </div>
          ))}
        </div>
        <Button type="button" label={t("actions.addLine")} icon="pi pi-plus" text onClick={() => append(EMPTY_LINE)} />

        <div className="erp-lines__totals">
          <span>
            {t("inventory.goodsReceipt.total")}: <strong>{formatMoney(total.toDecimalString(4), currency)}</strong>
          </span>
        </div>

        {errors.lines?.root?.message ? <p className="erp-field__error">{t(`validation.${errors.lines.root.message}`)}</p> : null}
        {createReceipt.isError ? <p className="erp-auth-card__error">{t("inventory.goodsReceipt.postError")}</p> : null}
        {createReceipt.isSuccess ? <p className="erp-field__hint">{t("inventory.goodsReceipt.postedSuccess", { number: createReceipt.data?.number })}</p> : null}

        <div className="erp-form__actions">
          <Button type="submit" label={t("inventory.goodsReceipt.submit")} loading={createReceipt.isPending} />
        </div>
      </form>
    </div>
  );
}
