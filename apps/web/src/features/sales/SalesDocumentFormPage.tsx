import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { useAllWarehouses } from "../inventory/use-warehouses";
import { useTaxCodes } from "../purchasing/use-invoicing";
import {
  useCreateQuotation,
  useCreateSalesInvoice,
  useCreateSalesOrder,
  useSalesOrder,
  type SalesLinePayload,
} from "./use-sales";

type Mode = "quotation" | "order" | "invoice";

const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;
const KNOWN_ERRORS = new Set([
  "INSUFFICIENT_STOCK",
  "OVER_INVOICED",
  "CUSTOMER_MISMATCH",
  "WAREHOUSE_REQUIRED",
  "DESCRIPTION_REQUIRED",
  "NO_OPEN_PERIOD",
  "ZERO_DOCUMENT",
  "INVALID_STATE",
  "ACCOUNT_NOT_POSTABLE",
]);

interface LineState {
  readonly key: string;
  readonly itemId: string;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly taxCodeId: string;
  readonly warehouseId: string;
  readonly salesOrderLineId: string;
}

let lineCounter = 0;
const nextKey = (): string => `sl-${++lineCounter}`;
const trimZeros = (value: string): string => (value.includes(".") ? value.replace(/\.?0+$/, "") : value);

// One form for the three documents of the chain — a quotation, a sales order, an invoice. They share
// the customer and the lines; an invoice also says which warehouse each stocked item leaves, and can
// start from an order (?order=<id>), taking whatever quantity is still to invoice.
function SalesDocumentForm({ mode }: { mode: Mode }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orderId = mode === "invoice" ? params.get("order") : null;
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: items } = useAllItems();
  const { data: warehouses } = useAllWarehouses();
  const { data: taxCodes } = useTaxCodes(false);
  const { data: order } = useSalesOrder(orderId);

  const createQuotation = useCreateQuotation();
  const createOrder = useCreateSalesOrder();
  const createInvoice = useCreateSalesInvoice();
  const mutation = mode === "quotation" ? createQuotation : mode === "order" ? createOrder : createInvoice;

  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState<Date>(new Date());
  const [secondDate, setSecondDate] = useState<Date | null>(null); // valid until / due date
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<readonly LineState[]>([]);

  const defaultTaxId = useMemo(() => (taxCodes?.find((c) => c.treatment === "STANDARD") ?? taxCodes?.[0])?.id ?? "", [taxCodes]);
  const defaultWarehouseId = warehouses?.[0]?.id ?? "";
  const rateById = useMemo(() => new Map((taxCodes ?? []).map((c) => [c.id, c.rate])), [taxCodes]);

  const blankLine = (): LineState => ({ key: nextKey(), itemId: "", description: "", quantity: "1", unitPrice: "", taxCodeId: defaultTaxId, warehouseId: defaultWarehouseId, salesOrderLineId: "" });

  // Start with one empty line once the tax codes are known.
  useEffect(() => {
    if (lines.length === 0 && !orderId && defaultTaxId) setLines([blankLine()]);
  }, [defaultTaxId]);

  // Starting an invoice from an order: copy what is still to invoice.
  useEffect(() => {
    if (!order || !defaultTaxId) return;
    setCustomerId(order.customerId);
    setLines(
      order.lines.flatMap((l) => {
        const left = Number(l.quantity) - Number(l.invoicedQuantity ?? "0");
        if (left <= 0) return [];
        return [
          {
            key: nextKey(),
            itemId: l.itemId ?? "",
            description: l.itemId ? "" : l.description,
            quantity: trimZeros(String(Number(left.toFixed(4)))),
            unitPrice: trimZeros(l.unitPrice),
            taxCodeId: l.taxCodeId,
            warehouseId: defaultWarehouseId,
            salesOrderLineId: l.id,
          },
        ];
      }),
    );
  }, [order?.id, defaultTaxId, defaultWarehouseId]);

  const setLine = (key: string, patch: Partial<LineState>): void => {
    mutation.reset();
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const lineValid = (l: LineState): boolean =>
    DECIMAL.test(l.quantity) &&
    /[1-9]/.test(l.quantity) &&
    DECIMAL.test(l.unitPrice) &&
    l.taxCodeId !== "" &&
    (l.itemId !== "" || l.description.trim() !== "") &&
    (mode !== "invoice" || l.itemId === "" || l.warehouseId !== "");
  const valid = customerId !== "" && lines.length > 0 && lines.every(lineValid);

  const totals = lines.reduce(
    (sum, l) => {
      if (!lineValid(l)) return sum;
      const net = Money.of(l.quantity, currency).multiply(l.unitPrice).round(4);
      // Percentage to fraction by exact decimal multiplication (no float division).
      const tax = net.multiply(rateById.get(l.taxCodeId) ?? "0").multiply("0.01").round(4);
      return { net: sum.net.add(net), tax: sum.tax.add(tax) };
    },
    { net: Money.zero(currency), tax: Money.zero(currency) },
  );

  const submit = (): void => {
    const payloadLines: SalesLinePayload[] = lines.map((l) => ({
      ...(l.itemId ? { itemId: l.itemId } : {}),
      ...(l.description.trim() ? { description: l.description.trim() } : {}),
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxCodeId: l.taxCodeId,
      ...(mode === "invoice" && l.itemId ? { warehouseId: l.warehouseId } : {}),
      ...(mode === "invoice" && l.salesOrderLineId ? { salesOrderLineId: l.salesOrderLineId } : {}),
    }));
    const common = { customerId, ...(notes.trim() ? { notes: notes.trim() } : {}), lines: payloadLines };
    const dateIso = toDateOnlyIsoString(date);
    const secondIso = secondDate ? toDateOnlyIsoString(secondDate) : null;
    const done = (): void => void navigate(mode === "quotation" ? "/sales/quotations" : mode === "order" ? "/sales/orders" : "/sales/invoices");

    if (mode === "quotation") createQuotation.mutate({ ...common, quotationDate: dateIso, ...(secondIso ? { validUntil: secondIso } : {}) }, { onSuccess: done });
    else if (mode === "order") createOrder.mutate({ ...common, orderDate: dateIso }, { onSuccess: done });
    else createInvoice.mutate({ ...common, invoiceDate: dateIso, ...(secondIso ? { dueDate: secondIso } : {}) }, { onSuccess: done });
  };

  const err = (mutation.error as { response?: { status?: number; data?: { error?: { code?: string; details?: { lineNumber?: number }[] } } } } | null)?.response;
  const errCode = err?.data?.error?.code;
  const errLine = err?.data?.error?.details?.[0]?.lineNumber;
  const errKey = mutation.isError ? (errCode && KNOWN_ERRORS.has(errCode) ? `sales.errors.${errCode}` : err?.status === 400 ? "sales.errors.badRequest" : "sales.errors.generic") : null;

  const prefix = `sales.${mode === "quotation" ? "quotations" : mode === "order" ? "orders" : "invoices"}`;

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t(`${prefix}.newTitle`)}</h1>
          <p className="erp-page__subtitle">{order ? t("sales.invoices.fromOrder", { number: order.number }) : t(`${prefix}.newSubtitle`)}</p>
        </div>
      </div>

      {taxCodes && taxCodes.length === 0 ? <p className="erp-auth-card__error">{t("sales.noTaxCodes")}</p> : null}

      <div className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="sdCustomer">{t("sales.customer")}</label>
            <PartyPicker inputId="sdCustomer" value={customerId || null} onChange={(party) => !orderId && setCustomerId(party?.id ?? "")} />
          </div>
          <div className="erp-field">
            <label htmlFor="sdDate">{t(`${prefix}.date`)}</label>
            <Calendar inputId="sdDate" value={date} onChange={(e) => e.value && setDate(e.value)} dateFormat="yy-mm-dd" />
          </div>
          {mode !== "order" ? (
            <div className="erp-field">
              <label htmlFor="sdSecond">{t(mode === "quotation" ? "sales.quotations.validUntil" : "sales.invoices.dueDate")}</label>
              <Calendar inputId="sdSecond" value={secondDate} onChange={(e) => setSecondDate((e.value as Date | null) ?? null)} dateFormat="yy-mm-dd" showButtonBar />
            </div>
          ) : null}
        </div>

        <h3 className="erp-form__section-title">{t("sales.lines")}</h3>
        <div className="erp-lines">
          {lines.map((l, index) => (
            <div key={l.key} className={`erp-lines__row${errLine === index + 1 ? " erp-lines__row--error" : ""}`}>
              <Dropdown
                value={l.itemId || null}
                onChange={(e) => setLine(l.key, { itemId: (e.value as string | null) ?? "" })}
                options={(items ?? []).map((i) => ({ label: `${i.code} — ${localizedName(i, i18n.language)}`, value: i.id }))}
                filter
                showClear
                disabled={l.salesOrderLineId !== ""}
                placeholder={t("sales.serviceLine")}
                className="erp-lines__account"
              />
              {l.itemId === "" ? (
                <InputText placeholder={t("sales.description")} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} disabled={l.salesOrderLineId !== ""} />
              ) : null}
              <InputText dir="ltr" placeholder={t("purchasing.quantity")} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} className={`erp-lines__amount${DECIMAL.test(l.quantity) ? "" : " p-invalid"}`} />
              <InputText dir="ltr" placeholder={t("purchasing.unitPrice")} value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} className={`erp-lines__amount${DECIMAL.test(l.unitPrice) ? "" : " p-invalid"}`} />
              <Dropdown
                value={l.taxCodeId || null}
                onChange={(e) => setLine(l.key, { taxCodeId: (e.value as string | null) ?? "" })}
                options={(taxCodes ?? []).map((c) => ({ label: c.code, value: c.id }))}
                placeholder={t("purchasing.invoices.taxCode")}
              />
              {mode === "invoice" && l.itemId !== "" ? (
                <Dropdown
                  value={l.warehouseId || null}
                  onChange={(e) => setLine(l.key, { warehouseId: (e.value as string | null) ?? "" })}
                  options={(warehouses ?? []).map((w) => ({ label: localizedName(w, i18n.language), value: w.id }))}
                  placeholder={t("inventory.warehouses.title")}
                />
              ) : null}
              <Button type="button" icon="pi pi-trash" text severity="danger" aria-label={t("actions.removeLine")} onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} disabled={lines.length <= 1} />
            </div>
          ))}
        </div>
        {!orderId ? <Button type="button" label={t("actions.addLine")} icon="pi pi-plus" text onClick={() => setLines((prev) => [...prev, blankLine()])} /> : null}

        <div className="erp-field">
          <label htmlFor="sdNotes">{t("purchasing.notes")}</label>
          <InputTextarea id="sdNotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="erp-table-footer">
          <span>
            {t("purchasing.invoices.net")}: <strong>{formatMoney(totals.net.toDecimalString(4), currency)}</strong>
          </span>
          <span>
            {t("purchasing.invoices.tax")}: <strong>{formatMoney(totals.tax.toDecimalString(4), currency)}</strong>
          </span>
          <span>
            {t("purchasing.invoices.gross")}: <strong>{formatMoney(totals.net.add(totals.tax).toDecimalString(4), currency)}</strong>
          </span>
        </div>

        {errKey ? (
          <p className="erp-auth-card__error">
            {t(errKey)}
            {errLine !== undefined ? ` (${t("sales.line", { number: errLine })})` : ""}
          </p>
        ) : null}

        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={() => void navigate(-1)} />
          <Button type="button" label={t(`${prefix}.submit`)} icon="pi pi-check" disabled={!valid} loading={mutation.isPending} onClick={submit} />
        </div>
      </div>
    </div>
  );
}

export const QuotationFormPage = (): React.JSX.Element => <SalesDocumentForm mode="quotation" />;
export const SalesOrderFormPage = (): React.JSX.Element => <SalesDocumentForm mode="order" />;
export const SalesInvoiceFormPage = (): React.JSX.Element => <SalesDocumentForm mode="invoice" />;
