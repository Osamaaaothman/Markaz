import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Money } from "@erp/shared";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PartyPicker } from "../accounting/PartyPicker";
import { useAllItems } from "../inventory/use-items";
import { useCreatePurchaseOrder, usePurchaseRequest } from "./use-purchasing";

const decimal = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, "positiveAmount");
const lineSchema = z.object({
  itemId: z.string().min(1, "required"),
  quantity: decimal.refine((v) => /[1-9]/.test(v), "positiveAmount"),
  unitPrice: decimal,
});
const formSchema = z.object({
  supplierId: z.string().min(1, "required"),
  orderDate: z.date(),
  expectedDate: z.date().nullable(),
  notes: z.string(),
  lines: z.array(lineSchema).min(1, "atLeastOneLine"),
});
type FormValues = z.infer<typeof formSchema>;
const EMPTY_LINE = { itemId: "", quantity: "", unitPrice: "" };

// A new order, optionally started from a pending purchase request (?request=<id>): its items and
// quantities are copied in and the buyer adds the supplier and the agreed prices.
export function PurchaseOrderFormPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestId = params.get("request");
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: items } = useAllItems();
  const { data: request } = usePurchaseRequest(requestId);
  const create = useCreatePurchaseOrder();

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { supplierId: "", orderDate: new Date(), expectedDate: null, notes: "", lines: [EMPTY_LINE] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const lines = watch("lines");

  useEffect(() => {
    if (!request || request.status !== "PENDING") return;
    reset({
      supplierId: "",
      orderDate: new Date(),
      expectedDate: null,
      notes: request.notes ?? "",
      lines: request.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity.replace(/\.?0+$/, ""), unitPrice: "" })),
    });
    // Copy the request in once it has loaded.
  }, [request?.id]);

  const total = lines.reduce((sum, line) => {
    try {
      if (line.quantity && line.unitPrice) return sum.add(Money.of(line.quantity, currency).multiply(line.unitPrice).round(4));
    } catch {
      /* invalid amount — surfaced by field-level validation instead */
    }
    return sum;
  }, Money.zero(currency));

  const onSubmit = handleSubmit((values) => {
    create.mutate(
      {
        supplierId: values.supplierId,
        orderDate: toDateOnlyIsoString(values.orderDate),
        ...(values.expectedDate ? { expectedDate: toDateOnlyIsoString(values.expectedDate) } : {}),
        ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
        ...(request?.status === "PENDING" && requestId ? { purchaseRequestId: requestId } : {}),
        lines: values.lines,
      },
      { onSuccess: (created) => void navigate(`/purchasing/orders/${created.id}`) },
    );
  });

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("purchasing.orders.newTitle")}</h1>
          <p className="erp-page__subtitle">{request ? t("purchasing.orders.fromRequest", { number: request.number }) : t("purchasing.orders.newSubtitle")}</p>
        </div>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="poSupplier">{t("purchasing.supplier")}</label>
            <Controller
              control={control}
              name="supplierId"
              render={({ field }) => <PartyPicker inputId="poSupplier" value={field.value || null} onChange={(party) => field.onChange(party?.id ?? "")} />}
            />
            {errors.supplierId ? <small className="erp-field__error">{t("validation.required")}</small> : null}
          </div>
          <div className="erp-field">
            <label htmlFor="poDate">{t("purchasing.orders.orderDate")}</label>
            <Controller control={control} name="orderDate" render={({ field }) => <Calendar inputId="poDate" value={field.value} onChange={(e) => field.onChange(e.value)} dateFormat="yy-mm-dd" />} />
          </div>
          <div className="erp-field">
            <label htmlFor="poExpected">{t("purchasing.orders.expectedDate")}</label>
            <Controller
              control={control}
              name="expectedDate"
              render={({ field }) => <Calendar inputId="poExpected" value={field.value} onChange={(e) => field.onChange(e.value ?? null)} dateFormat="yy-mm-dd" showButtonBar />}
            />
          </div>
        </div>

        <div className="erp-field">
          <label htmlFor="poNotes">{t("purchasing.notes")}</label>
          <InputTextarea id="poNotes" rows={2} {...register("notes")} />
        </div>

        <h3 className="erp-form__section-title">{t("purchasing.lines")}</h3>
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
              <InputText placeholder={t("purchasing.quantity")} dir="ltr" {...register(`lines.${index}.quantity`)} className={`erp-lines__amount${errors.lines?.[index]?.quantity ? " p-invalid" : ""}`} />
              <InputText placeholder={t("purchasing.unitPrice")} dir="ltr" {...register(`lines.${index}.unitPrice`)} className={`erp-lines__amount${errors.lines?.[index]?.unitPrice ? " p-invalid" : ""}`} />
              <Button type="button" icon="pi pi-trash" text severity="danger" aria-label={t("actions.removeLine")} onClick={() => remove(index)} disabled={fields.length <= 1} />
            </div>
          ))}
        </div>
        <Button type="button" label={t("actions.addLine")} icon="pi pi-plus" text onClick={() => append(EMPTY_LINE)} />

        <div className="erp-lines__totals">
          <span>
            {t("purchasing.total")}: <strong>{formatMoney(total.toDecimalString(4), currency)}</strong>
          </span>
        </div>

        {errors.lines?.root?.message ? <p className="erp-field__error">{t(`validation.${errors.lines.root.message}`)}</p> : null}
        {create.isError ? <p className="erp-auth-card__error">{t("purchasing.orders.createError")}</p> : null}

        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={() => void navigate("/purchasing/orders")} />
          <Button type="submit" label={t("purchasing.orders.create")} loading={create.isPending} />
        </div>
      </form>
    </div>
  );
}
