import { complianceIssueErrorKey } from "../compliance/issue-error-key";
import { useDocumentDraft } from "../documents/use-document-draft";
import { DraftBar } from "../documents/DraftBar";
import { StockHint } from "../inventory/StockHint";
import { LineField } from "../../shared/ui/LineField";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Money, newId, tafqeetAmount } from "@erp/shared";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { CreatedDialog, type CreatedInfo } from "../../shared/ui/CreatedDialog";
import { PartyPicker } from "../accounting/PartyPicker";
import { useComplianceOverview } from "../compliance/use-compliance";
import { useAllItems } from "../inventory/use-items";
import { useStockLevels } from "../inventory/use-stock-levels";
import { stockAvailability } from "../inventory/stock-availability";
import { useAllWarehouses } from "../inventory/use-warehouses";
import { useTaxCodes } from "../purchasing/use-invoicing";
import {
  useCreateQuotation,
  useCreateSalesInvoice,
  useCreateSalesOrder,
  useSalesInvoice,
  useSalesOrder,
  type SalesLinePayload,
} from "./use-sales";

type Mode = "quotation" | "order" | "invoice";

const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;
const KNOWN_ERRORS = new Set([
  "INSUFFICIENT_STOCK",
  "BELOW_COST",
  "ORDER_LINE_MISMATCH",
  "OVER_INVOICED",
  "CUSTOMER_MISMATCH",
  "WAREHOUSE_REQUIRED",
  "DESCRIPTION_REQUIRED",
  "NO_OPEN_PERIOD",
  "ZERO_DOCUMENT",
  "INVALID_STATE",
  "ACCOUNT_NOT_POSTABLE",
  "EGS_UNIT_REQUIRED",
  "EGS_UNIT_NOT_FOUND",
  "FUTURE_DATE",
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

const nextKey = (): string => newId();
const trimZeros = (value: string): string => (value.includes(".") ? value.replace(/\.?0+$/, "") : value);

// One form for the three documents of the chain — a quotation, a sales order, an invoice. They share
// the customer and the lines; an invoice also says which warehouse each stocked item leaves, and can
// start from an order (?order=<id>), taking whatever quantity is still to invoice.
function SalesDocumentForm({ mode }: { mode: Mode }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [restoredOrderId, setRestoredOrderId] = useState<string | null>(null);
  const orderId = mode === "invoice" ? restoredOrderId ?? params.get("order") : null;
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: items } = useAllItems();
  const { data: warehouses } = useAllWarehouses();
  const stockQuery = useStockLevels({ warehouseId: null, belowReorderOnly: false });
  const stockLevels = stockQuery.isError ? undefined : stockQuery.data;
  const { data: taxCodes } = useTaxCodes(false);
  const { data: order } = useSalesOrder(orderId);
  // Correcting an invoice ZATCA rejected (and that was voided): start from a copy of it.
  const copyFromId = mode === "invoice" && !params.get("draft") ? params.get("copyFrom") ?? "" : "";
  const { data: copyFrom } = useSalesInvoice(copyFromId);
  // Which ZATCA issuing unit (EGS) this invoice belongs to -- only relevant/shown once a company
  // has more than one active unit (docs/01-OPEN-DECISIONS.md); otherwise the backend assigns it
  // (or leaves it null) automatically, and this never needs to be asked.
  const { data: complianceOverview } = useComplianceOverview();
  const activeEgsUnits = useMemo(() => (complianceOverview?.egsUnits ?? []).filter((u) => u.isActive), [complianceOverview]);
  const [egsUnitId, setEgsUnitId] = useState("");
  // UNCL4461 payment means code for the ZATCA XML (10=cash, 42=bank transfer, 48=card);
  // invoice-only, defaulting to bank transfer like the backend column.
  const [paymentMeansCode, setPaymentMeansCode] = useState("42");




  const [created, setCreated] = useState<{ info: CreatedInfo; to: string } | null>(null);


  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState<Date>(new Date());
  const [actualDeliveryDate, setActualDeliveryDate] = useState<Date | null>(null);
  const [secondDate, setSecondDate] = useState<Date | null>(null); // valid until / due date
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<readonly LineState[]>([]);
  const draft = useDocumentDraft(mode === "quotation" ? "quotation" : mode === "order" ? "sales_order" : "sales_invoice", { customerId, date, secondDate, actualDeliveryDate, notes, lines, egsUnitId, paymentMeansCode, orderId }, (saved) => {
    setCustomerId(saved.customerId); setDate(saved.date); setSecondDate(saved.secondDate); setActualDeliveryDate(saved.actualDeliveryDate ?? null); setNotes(saved.notes); setLines(saved.lines); setEgsUnitId(saved.egsUnitId); setPaymentMeansCode(saved.paymentMeansCode ?? "42"); setRestoredOrderId(saved.orderId);
  }, customerId !== "" || notes !== "" || lines.some((l) => l.itemId || l.description || l.unitPrice));
  const createQuotation = useCreateQuotation(draft.id);
  const createOrder = useCreateSalesOrder(draft.id);
  const createInvoice = useCreateSalesInvoice(draft.id);
  const mutation = mode === "quotation" ? createQuotation : mode === "order" ? createOrder : createInvoice;

  const defaultTaxId = useMemo(() => (taxCodes?.find((c) => c.treatment === "STANDARD") ?? taxCodes?.[0])?.id ?? "", [taxCodes]);
  const rateById = useMemo(() => new Map((taxCodes ?? []).map((c) => [c.id, c.rate])), [taxCodes]);

  const blankLine = (): LineState => ({ key: nextKey(), itemId: "", description: "", quantity: "1", unitPrice: "", taxCodeId: defaultTaxId, warehouseId: "", salesOrderLineId: "" });

  // Start with one empty line once the tax codes are known.
  useEffect(() => {
    if (lines.length === 0 && !orderId && !copyFromId && defaultTaxId) setLines([blankLine()]);
  }, [defaultTaxId]);

  // Starting an invoice from an order: copy what is still to invoice.
  useEffect(() => {
    if (params.get("draft") || !order || !defaultTaxId) return;
    setCustomerId(order.customerId);
    setLines(
      order.lines.flatMap((l) => {
        const left = Money.of(l.quantity, currency).subtract(Money.of(l.invoicedQuantity ?? "0", currency));
        if (!left.isPositive()) return [];
        return [
          {
            key: nextKey(),
            itemId: l.itemId ?? "",
            description: l.itemId ? "" : l.description,
            quantity: trimZeros(left.toDecimalString(4)),
            unitPrice: trimZeros(l.unitPrice),
            taxCodeId: l.taxCodeId,
            // No warehouse is preselected: the person picks where each stocked line leaves from.
            warehouseId: "",
            salesOrderLineId: l.id,
          },
        ];
      }),
    );
  }, [order?.id, defaultTaxId]);

  useEffect(() => {
    if (!copyFrom || copyFrom.documentType !== "INVOICE" || !defaultTaxId) return;
    setCustomerId(copyFrom.customerId);
    setNotes(copyFrom.notes ?? "");
    setActualDeliveryDate(copyFrom.actualDeliveryDate ? new Date(`${copyFrom.actualDeliveryDate}T00:00:00`) : null);
    setLines(
      copyFrom.lines.map((l) => ({
        key: nextKey(),
        itemId: l.itemId ?? "",
        description: l.itemId ? "" : l.description,
        quantity: trimZeros(l.quantity),
        unitPrice: trimZeros(l.unitPrice),
        taxCodeId: l.taxCodeId,
        warehouseId: l.warehouseId ?? "",
        salesOrderLineId: l.salesOrderLineId ?? "",
      })),
    );
  }, [copyFrom?.id, defaultTaxId]);

  const setLine = (key: string, patch: Partial<LineState>): void => {
    mutation.reset();
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  // A line the auto-new-line-on-Enter feature added but the user never actually touched — no item,
  // no description, no price typed in. Dropped silently at save time rather than blocking the save
  // button or forcing a manual delete; a line the user DID start filling in still needs to be complete.
  const isBlankLine = (l: LineState): boolean => l.salesOrderLineId === "" && l.itemId === "" && l.description.trim() === "" && l.unitPrice.trim() === "";
  const meaningfulLines = lines.filter((l) => !isBlankLine(l));
  const availability = stockAvailability(lines, stockLevels, mode === "invoice" ? "warehouse" : "company");
  const stockWarning = lines.some((line, index) => line.itemId && (availability[index]?.onHand === null || availability[index]?.exceeded));
  const belowCost = (line: LineState): boolean => {
    if (!line.itemId || line.salesOrderLineId || !DECIMAL.test(line.unitPrice)) return false;
    const pool = (stockLevels ?? []).filter((stock) => stock.itemId === line.itemId && (mode !== "invoice" || stock.warehouseId === line.warehouseId) && Money.of(stock.quantity, currency).isPositive());
    const quantity = pool.reduce((sum, stock) => sum.add(Money.of(stock.quantity, currency)), Money.zero(currency));
    const value = pool.reduce((sum, stock) => sum.add(Money.of(stock.value, currency)), Money.zero(currency));
    return quantity.isPositive() && Money.of(line.unitPrice, currency).multiply(quantity.toDecimalString(4)).compareTo(value) < 0;
  };

  const lineValid = (l: LineState): boolean =>
    DECIMAL.test(l.quantity) &&
    /[1-9]/.test(l.quantity) &&
    DECIMAL.test(l.unitPrice) &&
    !belowCost(l) &&
    l.taxCodeId !== "" &&
    (l.itemId !== "" || l.description.trim() !== "") &&
    (mode !== "invoice" || l.itemId === "" || l.warehouseId !== "");
  const egsUnitChoiceNeeded = mode === "invoice" && activeEgsUnits.length > 1;
  const valid = customerId !== "" && meaningfulLines.length > 0 && meaningfulLines.every(lineValid) && (!egsUnitChoiceNeeded || egsUnitId !== "");

  const totals = meaningfulLines.reduce(
    (sum, l) => {
      if (!lineValid(l)) return sum;
      const net = Money.of(l.quantity, currency).multiply(l.unitPrice).round(4);
      // Percentage to fraction by exact decimal multiplication (no float division).
      const tax = net.multiply(rateById.get(l.taxCodeId) ?? "0").multiply("0.01").round(4);
      return { net: sum.net.add(net), tax: sum.tax.add(tax) };
    },
    { net: Money.zero(currency), tax: Money.zero(currency) },
  );

  const submit = async (): Promise<void> => {
    if (!valid || !draft.ready || !await draft.save()) return;
    const payloadLines: SalesLinePayload[] = meaningfulLines.map((l) => ({
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
    const listPath = mode === "quotation" ? "/sales/quotations" : mode === "order" ? "/sales/orders" : "/sales/invoices";
    const done = (saved: { readonly id: string; readonly number: string }): void => {
      void draft.complete();
      const gross = totals.net.add(totals.tax);
      setCreated({
        // An order or invoice opens on its own page; a quotation has none, so it goes back to the list.
        // Closing the "saved" dialog (its only action here) takes the person there.
        to: mode === "quotation" ? listPath : `${listPath}/${saved.id}`,
        info: {
          title: t(`sales.${mode === "quotation" ? "quotations" : mode === "order" ? "orders" : "invoices"}.newTitle`),
          headline: saved.number,
          rows: [
            { label: t("created.date"), value: dateIso, ltr: true },
            { label: mode === "order" ? "" : t(mode === "quotation" ? "sales.quotations.validUntil" : "created.dueDate"), value: secondIso ?? "", ltr: true },
            { label: t("created.net"), value: formatMoney(totals.net.toDecimalString(4), currency), ltr: true },
            { label: t("created.tax"), value: formatMoney(totals.tax.toDecimalString(4), currency), ltr: true },
            { label: t("created.gross"), value: formatMoney(gross.toDecimalString(4), currency), ltr: true },
            { label: t("created.inWords"), value: tafqeetAmount(gross.toDecimalString(4), currency, i18n.language) },
            { label: t("created.lines"), value: String(meaningfulLines.length) },
          ].filter((row) => row.label !== ""),
        },
      });
    };

    if (mode === "quotation") createQuotation.mutate({ ...common, quotationDate: dateIso, ...(secondIso ? { validUntil: secondIso } : {}) }, { onSuccess: done });
    else if (mode === "order") createOrder.mutate({ ...common, orderDate: dateIso }, { onSuccess: done });
    else createInvoice.mutate({ ...common, invoiceDate: dateIso, ...(actualDeliveryDate ? { actualDeliveryDate: toDateOnlyIsoString(actualDeliveryDate) } : {}), ...(secondIso ? { dueDate: secondIso } : {}), ...(egsUnitId ? { egsUnitId } : {}), paymentMeansCode }, { onSuccess: done });
  };

  const err = (mutation.error as { response?: { status?: number; data?: { error?: { code?: string; details?: { lineNumber?: number }[] } } } } | null)?.response;
  const errCode = err?.data?.error?.code;
  const errLine = err?.data?.error?.details?.[0]?.lineNumber;
  const errKey = mutation.isError ? (complianceIssueErrorKey(errCode) ?? (errCode && KNOWN_ERRORS.has(errCode) ? `sales.errors.${errCode}` : err?.status === 400 ? "sales.errors.badRequest" : "sales.errors.generic")) : null;

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

      <DraftBar draft={draft} />
      <div className="erp-form">
        <div className="erp-form__row erp-form__row--top">
          <div className="erp-field">
            <label htmlFor="sdCustomer">{t("sales.customer")}</label>
            <PartyPicker excludeEmployees kind="CUSTOMER" inputId="sdCustomer" value={customerId || null} onChange={(party) => !orderId && setCustomerId(party?.id ?? "")} />
          </div>
          <div className="erp-field">
            <label htmlFor="sdDate">{t(`${prefix}.date`)}</label>
            <Calendar inputId="sdDate" value={date} onChange={(e) => e.value && setDate(e.value)} dateFormat="yy-mm-dd" {...(mode === "invoice" ? { maxDate: new Date() } : {})} />
          </div>
          {mode !== "order" ? (
            <div className="erp-field">
              <label htmlFor="sdSecond">{t(mode === "quotation" ? "sales.quotations.validUntil" : "sales.invoices.dueDate")}</label>
              <Calendar inputId="sdSecond" value={secondDate} onChange={(e) => setSecondDate((e.value as Date | null) ?? null)} dateFormat="yy-mm-dd" showButtonBar />
            </div>
          ) : null}
          {mode === "invoice" ? <div className="erp-field">
            <label htmlFor="sdSupplyDate">{t("sales.invoices.actualDeliveryDate")}</label>
            <Calendar inputId="sdSupplyDate" value={actualDeliveryDate} onChange={(e) => setActualDeliveryDate((e.value as Date | null) ?? null)} dateFormat="yy-mm-dd" showButtonBar />
            <small className="erp-field__hint">{t("sales.invoices.actualDeliveryDateHint")}</small>
          </div> : null}
          {mode === "invoice" ? (
            <div className="erp-field">
              <label htmlFor="sdPaymentMethod">{t("sales.invoices.paymentMethod")}</label>
              <Dropdown
                inputId="sdPaymentMethod"
                value={paymentMeansCode}
                onChange={(e) => setPaymentMeansCode(e.value as string)}
                options={[
                  { value: "10", label: t("sales.invoices.paymentMethods.CASH") },
                  { value: "42", label: t("sales.invoices.paymentMethods.BANK_TRANSFER") },
                  { value: "48", label: t("sales.invoices.paymentMethods.CARD") },
                ]}
              />
            </div>
          ) : null}
          {egsUnitChoiceNeeded ? (
            <div className="erp-field">
              <label htmlFor="sdEgsUnit">{t("sales.invoices.egsUnit")}</label>
              <Dropdown
                inputId="sdEgsUnit"
                value={egsUnitId || null}
                onChange={(e) => setEgsUnitId((e.value as string | null) ?? "")}
                options={activeEgsUnits.map((u) => ({ label: `${u.name}${u.branchName ? ` — ${u.branchName}` : ""} (${t(`compliance.environment.${u.environment}`)})`, value: u.id }))}
                placeholder={t("sales.invoices.egsUnitPlaceholder")}
                className={egsUnitId === "" ? "p-invalid" : ""}
              />
            </div>
          ) : null}
        </div>

        <h3 className="erp-form__section-title">{t("sales.lines")}</h3>

        <div className="erp-lines">
          {lines.map((l, index) => {
            const stock = availability[index]!;
            return (
            <div key={l.key} className={`erp-lines__row${errLine === index + 1 ? " erp-lines__row--error" : ""}`}>
              <LineField label={t("sales.item")}><Dropdown
                value={l.itemId || null}
                onChange={(e) => setLine(l.key, { itemId: (e.value as string | null) ?? "" })}
                options={(items ?? []).map((i) => ({ label: `${i.code} — ${localizedName(i, i18n.language)}`, value: i.id }))}
                filter
                showClear
                disabled={l.salesOrderLineId !== ""}
                placeholder={t("sales.serviceLine")}
                className="erp-lines__account"
              /></LineField>
              {l.itemId === "" ? (
                <LineField label={t("sales.description")}><InputText placeholder={t("sales.description")} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} disabled={l.salesOrderLineId !== ""} /></LineField>
              ) : null}
              <LineField label={t("purchasing.quantity")} hint={l.itemId ? <StockHint {...stock} scope={mode === "invoice" ? "warehouse" : "company"} /> : undefined}><InputText dir="ltr" placeholder={t("purchasing.quantity")} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} className={`erp-lines__amount${DECIMAL.test(l.quantity) ? "" : " p-invalid"}`} /></LineField>
              <LineField label={t("purchasing.unitPrice")} hint={l.salesOrderLineId ? t("sales.priceLocked") : belowCost(l) ? <span className="erp-field__warning">{t("sales.errors.BELOW_COST")}</span> : undefined}><InputText
                dir="ltr"
                placeholder={t("purchasing.unitPrice")}
                value={l.unitPrice}
                disabled={l.salesOrderLineId !== ""}
                onChange={(e) => setLine(l.key, { unitPrice: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !orderId && index === lines.length - 1) {
                    e.preventDefault();
                    setLines((prev) => [...prev, blankLine()]);
                  }
                }}
                className={`erp-lines__amount${DECIMAL.test(l.unitPrice) ? "" : " p-invalid"}`}
              /></LineField>
              <LineField label={t("purchasing.invoices.taxCode")}><Dropdown
                value={l.taxCodeId || null}
                disabled={l.salesOrderLineId !== ""}
                onChange={(e) => setLine(l.key, { taxCodeId: (e.value as string | null) ?? "" })}
                options={(taxCodes ?? []).map((c) => ({ label: c.code, value: c.id }))}
                placeholder={t("purchasing.invoices.taxCode")}
              /></LineField>
              {mode === "invoice" && l.itemId !== "" ? (
                <div style={{ flex: "0 0 10rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                  <LineField label={t("inventory.warehouses.title")}><Dropdown
                    value={l.warehouseId || null}
                    onChange={(e) => setLine(l.key, { warehouseId: (e.value as string | null) ?? "" })}
                    options={(warehouses ?? []).map((w) => ({ label: localizedName(w, i18n.language), value: w.id }))}
                    placeholder={t("inventory.warehouses.title")}
                    className={l.warehouseId === "" ? "p-invalid" : ""}
                  /></LineField>
                </div>
              ) : null}
              <Button type="button" icon="pi pi-trash" text severity="danger" aria-label={t("actions.removeLine")} onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} disabled={lines.length <= 1} />
            </div>
            );
          })}
        </div>
        {!orderId ? <Button type="button" data-erp-add-line label={t("actions.addLine")} icon="pi pi-plus" text onClick={() => setLines((prev) => [...prev, blankLine()])} /> : null}

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

        {stockWarning ? (
          <p className="erp-auth-card__warning">{t(mode === "invoice" ? "sales.errors.INSUFFICIENT_STOCK_WARN" : "inventory.stockLevels.offerWarning")}</p>
        ) : null}

        {errKey ? (
          <p className="erp-auth-card__error">
            {t(errKey)}
            {errLine !== undefined ? ` (${t("sales.line", { number: errLine })})` : ""}
          </p>
        ) : null}

        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={() => void navigate(-1)} />
          <Button type="button" label={mode === "invoice" ? t("sales.invoices.submit") : t("actions.save")} icon="pi pi-check" disabled={!valid || !draft.ready || created !== null} loading={mutation.isPending} onClick={() => { void submit(); }} />
        </div>
      </div>
      <CreatedDialog info={created?.info ?? null} onHide={() => created && void navigate(created.to)} />
    </div>
  );
}

export const QuotationFormPage = (): React.JSX.Element => <SalesDocumentForm mode="quotation" />;
export const SalesOrderFormPage = (): React.JSX.Element => <SalesDocumentForm mode="order" />;
export const SalesInvoiceFormPage = (): React.JSX.Element => <SalesDocumentForm mode="invoice" />;
