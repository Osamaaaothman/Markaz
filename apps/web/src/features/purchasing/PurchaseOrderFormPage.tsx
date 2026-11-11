import { useDocumentDraft } from "../documents/use-document-draft";
import { DraftBar } from "../documents/DraftBar";
import { LineField } from "../../shared/ui/LineField";
import { useEffect, useMemo, useState } from "react";
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
import { Money, tafqeetAmount } from "@erp/shared";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PartyPicker } from "../accounting/PartyPicker";
import { CreatedDialog, type CreatedInfo } from "../../shared/ui/CreatedDialog";
import { useAllWarehouses } from "../inventory/use-warehouses";
import { useAllItems } from "../inventory/use-items";
import { useTaxCodes } from "./use-invoicing";
import { useCreatePurchaseOrder, usePurchaseRequest } from "./use-purchasing";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { requestLinesForOrder } from "./request-lines";

const decimal = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, "positiveAmount");
const lineSchema = z.object({
  itemId: z.string().min(1, "required"),
  quantity: decimal.refine((v) => /[1-9]/.test(v), "positiveAmount"),
  unitPrice: decimal,
  taxCodeId: z.string().min(1, "required"),
});
const formSchema = z.object({
  supplierId: z.string().min(1, "required"),
  warehouseId: z.string().min(1, "required"),
  orderDate: z.date(),
  expectedDate: z.date().nullable(),
  notes: z.string(),
  lines: z.array(lineSchema).min(1, "atLeastOneLine"),
});
type FormValues = z.infer<typeof formSchema>;

// A new order, optionally started from an accepted purchase request (?request=<id>): its items and
// quantities are copied in and the buyer adds the supplier and the agreed prices.
export function PurchaseOrderFormPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [restoredRequestId, setRestoredRequestId] = useState<string | null>(null);
  const requestId = restoredRequestId ?? params.get("request");
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: items } = useAllItems();
  const { data: warehouses } = useAllWarehouses();
  const [created, setCreated] = useState<CreatedInfo | null>(null);
  const { data: request, isPending: requestPending, isError: requestError, refetch: refetchRequest } = usePurchaseRequest(requestId);
  const [copiedRequestId, setCopiedRequestId] = useState<string | null>(null);
  const { data: taxCodes } = useTaxCodes(false);
  const defaultTaxId = useMemo(() => (taxCodes?.find((c) => c.treatment === "STANDARD") ?? taxCodes?.[0])?.id ?? "", [taxCodes]);

  // A fresh line always starts on the company's default VAT code, once tax codes have loaded.
  const newLine = (): FormValues["lines"][number] => ({ itemId: "", quantity: "", unitPrice: "", taxCodeId: defaultTaxId });

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    getValues,
    setValue,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { supplierId: "", warehouseId: "", orderDate: new Date(), expectedDate: null, notes: "", lines: [newLine()] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const draftValues = { ...watch(), requestId };
  const draft = useDocumentDraft("purchase_order", draftValues, (saved) => { reset(saved); setRestoredRequestId(saved.requestId); setCopiedRequestId(saved.requestId); }, isDirty || draftValues.lines.some((l) => l.itemId !== ""));
  const create = useCreatePurchaseOrder(draft.id);
  const lines = watch("lines");

  // Tax codes arrive after the form mounts; fill any line that still has no code so Save is not blocked.
  useEffect(() => {
    if (!defaultTaxId) return;
    getValues("lines").forEach((line, index) => {
      if (!line.taxCodeId) setValue(`lines.${index}.taxCodeId`, defaultTaxId);
    });
  }, [defaultTaxId, getValues, setValue]);

  // A line the auto-new-line-on-Enter feature added but the user never touched — dropped silently
  // right before validation runs, instead of blocking the save button or forcing a manual delete.
  const isBlankLine = (l: FormValues["lines"][number]): boolean => l.itemId === "" && l.quantity.trim() === "" && l.unitPrice.trim() === "";
  const submitWithCleanup = (e: React.BaseSyntheticEvent): void => {
    const blankIndexes = watch("lines").reduce<number[]>((acc, l, i) => (isBlankLine(l) ? [...acc, i] : acc), []);
    if (blankIndexes.length > 0) remove(blankIndexes);
    void onSubmit(e);
  };

  useEffect(() => {
    if (params.get("draft") || !request || request.status !== "ACCEPTED" || !defaultTaxId || copiedRequestId === request.id) return;
    reset({
      supplierId: "",
      // The request already says which warehouse the goods are for.
      warehouseId: request.warehouseId ?? "",
      orderDate: new Date(),
      expectedDate: null,
      notes: request.notes ?? "",
      lines: requestLinesForOrder(request.lines, defaultTaxId),
    });
    setCopiedRequestId(request.id);
  }, [request, defaultTaxId, copiedRequestId, reset]);

  const total = lines.reduce((sum, line) => {
    try {
      if (line.quantity && line.unitPrice) return sum.add(Money.of(line.quantity, currency).multiply(line.unitPrice).round(4));
    } catch {
      /* invalid amount — surfaced by field-level validation instead */
    }
    return sum;
  }, Money.zero(currency));

  // Client-side estimate only, matching the backend: net × rate / 100, rounded to 4 decimals.
  const taxTotal = lines.reduce((sum, line) => {
    try {
      if (line.quantity && line.unitPrice && line.taxCodeId) {
        const rate = taxCodes?.find((c) => c.id === line.taxCodeId)?.rate;
        if (rate) return sum.add(Money.of(line.quantity, currency).multiply(line.unitPrice).multiply(rate).multiply("0.01").round(4));
      }
    } catch {
      /* invalid amount — surfaced by field-level validation instead */
    }
    return sum;
  }, Money.zero(currency));
  const grossTotal = total.add(taxTotal);

  const onSubmit = handleSubmit(async (values) => {
    if (!draft.ready || !await draft.save()) return;
    if (created || create.isPending || (requestId && (request?.status !== "ACCEPTED" || copiedRequestId !== requestId))) return;
    create.mutate(
      {
        supplierId: values.supplierId,
        warehouseId: values.warehouseId,
        orderDate: toDateOnlyIsoString(values.orderDate),
        ...(values.expectedDate ? { expectedDate: toDateOnlyIsoString(values.expectedDate) } : {}),
        ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
        ...(request?.status === "ACCEPTED" && requestId ? { purchaseRequestId: requestId } : {}),
        lines: values.lines,
      },
      {
        onSuccess: (saved) => {
          void draft.complete();
          const warehouse = warehouses?.find((w) => w.id === values.warehouseId);
          setCreated({
            onOpen: () => void navigate(`/purchasing/orders/${saved.id}`),
            title: t("purchasing.orders.newTitle"),
            headline: saved.number,
            rows: [
              { label: t("created.status"), value: t(`purchasing.orderStatus.${saved.status}`) },
              { label: t("created.warehouse"), value: warehouse ? localizedName(warehouse, i18n.language) : "" },
              { label: t("created.date"), value: toDateOnlyIsoString(values.orderDate), ltr: true },
              { label: t("created.total"), value: formatMoney(total.toDecimalString(4), currency), ltr: true },
              { label: t("created.inWords"), value: tafqeetAmount(total.toDecimalString(4), currency) },
              { label: t("created.lines"), value: String(values.lines.length) },
            ],
          });
        },
      },
    );
  });

  if (requestId && !created) {
    if (requestPending) return <PageSkeleton />;
    if (requestError || !request || request.status !== "ACCEPTED") return (
      <div className="erp-page" role="alert">
        <p className="erp-page__error">{t(requestError ? "status.error" : "purchasing.orders.requestUnavailable")}</p>
        <Button label={t("actions.retry")} onClick={() => void refetchRequest()} />
        <Button label={t("actions.cancel")} text onClick={() => void navigate("/purchasing/orders")} />
      </div>
    );
  }

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("purchasing.orders.newTitle")}</h1>
          <p className="erp-page__subtitle">{request ? t("purchasing.orders.fromRequest", { number: request.number }) : t("purchasing.orders.newSubtitle")}</p>
        </div>
      </div>

      <DraftBar draft={draft} />
      <form onSubmit={(e) => { e.preventDefault(); submitWithCleanup(e); }} noValidate className="erp-form">
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
            <label htmlFor="poWarehouse">{t("created.warehouse")}</label>
            <Controller
              control={control}
              name="warehouseId"
              render={({ field }) => (
                <Dropdown
                  inputId="poWarehouse"
                  value={field.value || null}
                  onChange={(e) => field.onChange((e.value as string | null) ?? "")}
                  options={(warehouses ?? []).map((w) => ({ label: `${w.code} — ${localizedName(w, i18n.language)}`, value: w.id }))}
                  filter
                  placeholder={t("purchasing.requests.chooseWarehouse")}
                  className={errors.warehouseId ? "p-invalid" : ""}
                />
              )}
            />
            {errors.warehouseId ? <small className="erp-field__error">{t("purchasing.requests.warehouseRequired")}</small> : null}
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
              <LineField label={t("purchasing.quantity")}><InputText placeholder={t("purchasing.quantity")} dir="ltr" {...register(`lines.${index}.quantity`)} className={`erp-lines__amount${errors.lines?.[index]?.quantity ? " p-invalid" : ""}`} /></LineField>
              <LineField label={t("purchasing.unitPrice")}><InputText
                placeholder={t("purchasing.unitPrice")}
                dir="ltr"
                {...register(`lines.${index}.unitPrice`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && index === fields.length - 1) {
                    e.preventDefault();
                    append(newLine());
                  }
                }}
                className={`erp-lines__amount${errors.lines?.[index]?.unitPrice ? " p-invalid" : ""}`}
              /></LineField>
              <Controller
                control={control}
                name={`lines.${index}.taxCodeId`}
                render={({ field: f }) => (
                  <LineField label={t("purchasing.invoices.taxCode")}><Dropdown
                    value={f.value || null}
                    onChange={(e) => f.onChange((e.value as string | null) ?? "")}
                    options={(taxCodes ?? []).map((c) => ({ label: c.code, value: c.id }))}
                    placeholder={t("purchasing.invoices.taxCode")}
                    className={errors.lines?.[index]?.taxCodeId ? "p-invalid" : ""}
                  /></LineField>
                )}
              />
              <Button type="button" icon="pi pi-trash" text severity="danger" aria-label={t("actions.removeLine")} onClick={() => remove(index)} disabled={fields.length <= 1} />
            </div>
          ))}
        </div>
        <Button type="button" data-erp-add-line label={t("actions.addLine")} icon="pi pi-plus" text onClick={() => append(newLine())} />

        <div className="erp-lines__totals">
          <span>
            {t("purchasing.invoices.net")}: <strong>{formatMoney(total.toDecimalString(4), currency)}</strong>
          </span>
          <span>
            {t("purchasing.invoices.tax")}: <strong>{formatMoney(taxTotal.toDecimalString(4), currency)}</strong>
          </span>
          <span>
            {t("purchasing.invoices.gross")}: <strong>{formatMoney(grossTotal.toDecimalString(4), currency)}</strong>
          </span>
        </div>

        {errors.lines?.root?.message ? <p className="erp-field__error">{t(`validation.${errors.lines.root.message}`)}</p> : null}
        {create.isError ? <p className="erp-auth-card__error">{t("purchasing.orders.createError")}</p> : null}

        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={() => void navigate("/purchasing/orders")} />
          <Button type="submit" label={t("actions.save")} loading={create.isPending} disabled={!draft.ready || created !== null || (requestId !== null && copiedRequestId !== requestId)} />
        </div>
      </form>
      <CreatedDialog info={created} onHide={() => void navigate("/purchasing/orders")} />
    </div>
  );
}
