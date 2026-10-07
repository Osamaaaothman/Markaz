import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Checkbox } from "primereact/checkbox";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PartyPicker } from "../accounting/PartyPicker";
import { useChartOfAccounts } from "../accounting/use-chart-of-accounts";
import {
  useInvoiceableLines,
  usePostInvoice,
  usePreviewInvoice,
  useTaxCodes,
  type InvoiceLinePayload,
  type InvoicePayload,
  type InvoicePreviewLine,
} from "./use-invoicing";

const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;

// Business-rule codes the API can answer with; each has its own translated message.
const KNOWN_ERRORS = new Set([
  "QTY_EXCEEDS_RECEIVED",
  "PRICE_VARIANCE_NOT_ACCEPTED",
  "DUPLICATE_INVOICE",
  "SUPPLIER_MISMATCH",
  "ACCOUNT_NOT_POSTABLE",
  "NO_OPEN_PERIOD",
  "ZERO_INVOICE",
  "EMPTY_INVOICE",
]);

interface LineState {
  readonly key: string;
  readonly kind: "PO_LINE" | "EXPENSE";
  readonly purchaseOrderLineId: string;
  readonly accountId: string;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly taxCodeId: string;
}

let lineCounter = 0;
const nextKey = (): string => `line-${++lineCounter}`;
const trimZeros = (value: string): string => (value.includes(".") ? value.replace(/\.?0+$/, "") : value);

// Matching an invoice: pick the supplier, add the order lines the invoice covers (quantity and price
// start at what was received and what was ordered) and any expense lines, then Review. The review
// shows each difference against the order and the receipt; a price difference must be ticked as
// accepted before it can be posted, and more than was received cannot be posted at all.
export function SupplierInvoiceFormPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: taxCodes } = useTaxCodes(false);
  const { data: accounts } = useChartOfAccounts();
  const preview = usePreviewInvoice();
  const post = usePostInvoice();

  const [supplierId, setSupplierId] = useState("");
  const [number, setNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState<Date>(new Date());
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<readonly LineState[]>([]);
  const [accept, setAccept] = useState(false);

  const { data: invoiceable } = useInvoiceableLines(supplierId);
  const defaultTaxId = useMemo(() => (taxCodes?.find((c) => c.treatment === "STANDARD") ?? taxCodes?.[0])?.id ?? "", [taxCodes]);
  const postable = (accounts ?? []).filter((a) => a.isPostable);

  // Any edit makes an earlier review stale.
  const edit = (change: () => void): void => {
    change();
    preview.reset();
    post.reset();
    setAccept(false);
  };

  const used = new Set(lines.flatMap((l) => (l.purchaseOrderLineId ? [l.purchaseOrderLineId] : [])));
  const available = (invoiceable ?? []).filter((l) => !used.has(l.purchaseOrderLineId));

  const addPoLine = (id: string): void => {
    const source = invoiceable?.find((l) => l.purchaseOrderLineId === id);
    if (!source) return;
    edit(() =>
      setLines((prev) => [
        ...prev,
        {
          key: nextKey(),
          kind: "PO_LINE",
          purchaseOrderLineId: id,
          accountId: "",
          description: "",
          quantity: trimZeros(source.invoiceableQuantity),
          unitPrice: trimZeros(source.orderPrice),
          taxCodeId: defaultTaxId,
        },
      ]),
    );
  };

  const addExpenseLine = (): void =>
    edit(() => setLines((prev) => [...prev, { key: nextKey(), kind: "EXPENSE", purchaseOrderLineId: "", accountId: "", description: "", quantity: "1", unitPrice: "", taxCodeId: defaultTaxId }]));

  const setLine = (key: string, patch: Partial<LineState>): void => edit(() => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l))));
  const removeLine = (key: string): void => edit(() => setLines((prev) => prev.filter((l) => l.key !== key)));

  const lineValid = (l: LineState): boolean =>
    DECIMAL.test(l.quantity) && /[1-9]/.test(l.quantity) && DECIMAL.test(l.unitPrice) && l.taxCodeId !== "" && (l.kind === "PO_LINE" ? l.purchaseOrderLineId !== "" : l.accountId !== "");
  const formValid = supplierId !== "" && number.trim() !== "" && lines.length > 0 && lines.every(lineValid);

  const payload: InvoicePayload = {
    supplierId,
    supplierInvoiceNumber: number.trim(),
    invoiceDate: toDateOnlyIsoString(invoiceDate),
    ...(dueDate ? { dueDate: toDateOnlyIsoString(dueDate) } : {}),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    ...(accept ? { acceptPriceVariance: true } : {}),
    lines: lines.map(
      (l): InvoiceLinePayload => ({
        kind: l.kind,
        ...(l.kind === "PO_LINE" ? { purchaseOrderLineId: l.purchaseOrderLineId } : { accountId: l.accountId }),
        ...(l.description.trim() ? { description: l.description.trim() } : {}),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxCodeId: l.taxCodeId,
      }),
    ),
  };

  const result = preview.data;
  const canPost = result !== undefined && result.canPost && (!result.hasPriceVariance || accept);
  const postStatus = (post.error as { response?: { status?: number; data?: { error?: { code?: string } } } } | null)?.response;
  const postErrorKey = post.isError
    ? postStatus?.data?.error?.code && KNOWN_ERRORS.has(postStatus.data.error.code)
      ? `purchasing.invoices.errors.${postStatus.data.error.code}`
      : postStatus?.status === 400
        ? "purchasing.invoices.errors.badRequest"
        : "purchasing.invoices.errors.generic"
    : null;

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("purchasing.invoices.newTitle")}</h1>
          <p className="erp-page__subtitle">{t("purchasing.invoices.newSubtitle")}</p>
        </div>
      </div>

      {taxCodes && taxCodes.length === 0 ? <p className="erp-auth-card__error">{t("purchasing.invoices.noTaxCodes")}</p> : null}

      <div className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="siSupplier">{t("purchasing.supplier")}</label>
            <PartyPicker
              inputId="siSupplier"
              value={supplierId || null}
              onChange={(party) =>
                edit(() => {
                  setSupplierId(party?.id ?? "");
                  setLines([]);
                })
              }
            />
          </div>
          <div className="erp-field">
            <label htmlFor="siNumber">{t("purchasing.invoices.supplierInvoiceNumber")}</label>
            <InputText id="siNumber" dir="ltr" value={number} onChange={(e) => edit(() => setNumber(e.target.value))} />
          </div>
          <div className="erp-field">
            <label htmlFor="siDate">{t("purchasing.invoices.invoiceDate")}</label>
            <Calendar inputId="siDate" value={invoiceDate} onChange={(e) => e.value && edit(() => setInvoiceDate(e.value as Date))} dateFormat="yy-mm-dd" />
          </div>
          <div className="erp-field">
            <label htmlFor="siDue">{t("purchasing.invoices.dueDate")}</label>
            <Calendar inputId="siDue" value={dueDate} onChange={(e) => edit(() => setDueDate((e.value as Date | null) ?? null))} dateFormat="yy-mm-dd" showButtonBar />
          </div>
        </div>

        <h3 className="erp-form__section-title">{t("purchasing.lines")}</h3>
        <div className="erp-row-actions">
          <Dropdown
            value={null}
            placeholder={supplierId ? t("purchasing.invoices.addOrderLine") : t("purchasing.invoices.pickSupplierFirst")}
            disabled={!supplierId || available.length === 0}
            onChange={(e) => addPoLine(e.value as string)}
            options={available.map((l) => ({
              label: `${l.purchaseOrderNumber} · ${l.itemCode} — ${localizedName({ name: l.itemName, nameAr: l.itemNameAr }, i18n.language)} · ${trimZeros(l.invoiceableQuantity)} ${l.unit}`,
              value: l.purchaseOrderLineId,
            }))}
          />
          <Button type="button" label={t("purchasing.invoices.addExpenseLine")} icon="pi pi-plus" text onClick={addExpenseLine} disabled={!supplierId} />
        </div>
        {supplierId && invoiceable && invoiceable.length === 0 ? <p className="erp-field__hint">{t("purchasing.invoices.nothingToMatch")}</p> : null}

        {lines.length > 0 ? (
          <div className="erp-lines">
            {lines.map((l) => {
              const source = invoiceable?.find((x) => x.purchaseOrderLineId === l.purchaseOrderLineId);
              return (
                <div key={l.key} className="erp-lines__row">
                  {l.kind === "PO_LINE" ? (
                    <span className="erp-lines__account">
                      {source ? `${source.purchaseOrderNumber} · ${source.itemCode} — ${localizedName({ name: source.itemName, nameAr: source.itemNameAr }, i18n.language)}` : l.purchaseOrderLineId}
                    </span>
                  ) : (
                    <Dropdown
                      value={l.accountId || null}
                      onChange={(e) => setLine(l.key, { accountId: (e.value as string | null) ?? "" })}
                      options={postable.map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id }))}
                      filter
                      placeholder={t("purchasing.invoices.expenseAccount")}
                      className="erp-lines__account"
                    />
                  )}
                  <InputText dir="ltr" placeholder={t("purchasing.quantity")} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} className={`erp-lines__amount${DECIMAL.test(l.quantity) ? "" : " p-invalid"}`} />
                  <InputText dir="ltr" placeholder={t("purchasing.unitPrice")} value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} className={`erp-lines__amount${DECIMAL.test(l.unitPrice) ? "" : " p-invalid"}`} />
                  <Dropdown
                    value={l.taxCodeId || null}
                    onChange={(e) => setLine(l.key, { taxCodeId: (e.value as string | null) ?? "" })}
                    options={(taxCodes ?? []).map((c) => ({ label: `${c.code}`, value: c.id }))}
                    placeholder={t("purchasing.invoices.taxCode")}
                  />
                  <Button type="button" icon="pi pi-trash" text severity="danger" aria-label={t("actions.removeLine")} onClick={() => removeLine(l.key)} />
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="erp-field">
          <label htmlFor="siNotes">{t("purchasing.notes")}</label>
          <InputTextarea id="siNotes" rows={2} value={notes} onChange={(e) => edit(() => setNotes(e.target.value))} />
        </div>

        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={() => void navigate("/purchasing/invoices")} />
          <Button type="button" label={t("purchasing.invoices.review")} icon="pi pi-search" outlined disabled={!formValid} loading={preview.isPending} onClick={() => preview.mutate(payload)} />
        </div>
        {preview.isError ? <p className="erp-auth-card__error">{t("purchasing.invoices.errors.generic")}</p> : null}

        {result ? (
          <>
            <h3 className="erp-form__section-title">{t("purchasing.invoices.reviewTitle")}</h3>
            <DataTable value={[...result.lines]} className="erp-table" size="small" showGridlines>
              <Column header="#" style={{ width: "3rem" }} body={(l: InvoicePreviewLine) => l.lineNumber} />
              <Column header={t("purchasing.invoices.description")} body={(l: InvoicePreviewLine) => l.description} />
              <Column header={t("purchasing.quantity")} align="right" body={(l: InvoicePreviewLine) => trimZeros(l.quantity)} />
              <Column header={t("purchasing.unitPrice")} align="right" body={(l: InvoicePreviewLine) => trimZeros(l.unitPrice)} />
              <Column header={t("purchasing.invoices.orderPrice")} align="right" body={(l: InvoicePreviewLine) => (l.orderPrice === null ? "—" : trimZeros(l.orderPrice))} />
              <Column
                header={t("purchasing.invoices.variance")}
                align="right"
                body={(l: InvoicePreviewLine) =>
                  Number(l.priceVariance) === 0 ? "—" : <span className="erp-page__error">{formatMoney(l.priceVariance, currency)}</span>
                }
              />
              <Column header={t("purchasing.invoices.net")} align="right" body={(l: InvoicePreviewLine) => formatMoney(l.net, currency)} />
              <Column header={t("purchasing.invoices.tax")} align="right" body={(l: InvoicePreviewLine) => formatMoney(l.tax, currency)} />
              <Column
                header=""
                body={(l: InvoicePreviewLine) =>
                  l.issue ? <span className="erp-page__error">{t("purchasing.invoices.qtyExceeds", { max: trimZeros(l.invoiceableQuantity ?? "0") })}</span> : null
                }
              />
            </DataTable>
            <div className="erp-table-footer">
              <span>
                {t("purchasing.invoices.net")}: <strong>{formatMoney(result.totalNet, currency)}</strong>
              </span>
              <span>
                {t("purchasing.invoices.tax")}: <strong>{formatMoney(result.totalTax, currency)}</strong>
              </span>
              <span>
                {t("purchasing.invoices.gross")}: <strong>{formatMoney(result.totalGross, currency)}</strong>
              </span>
            </div>

            {result.hasPriceVariance ? (
              <label className="coa-levels" htmlFor="siAccept">
                <Checkbox inputId="siAccept" checked={accept} onChange={(e) => setAccept(Boolean(e.checked))} />
                <span className="coa-levels__label">{t("purchasing.invoices.acceptVariance", { amount: formatMoney(result.totalPriceVariance, currency) })}</span>
              </label>
            ) : null}
            {!result.canPost ? <p className="erp-auth-card__error">{t("purchasing.invoices.cannotPost")}</p> : null}
            {postErrorKey ? <p className="erp-auth-card__error">{t(postErrorKey)}</p> : null}

            <div className="erp-form__actions">
              <Button
                type="button"
                label={t("purchasing.invoices.post")}
                icon="pi pi-check"
                disabled={!canPost}
                loading={post.isPending}
                onClick={() => post.mutate(payload, { onSuccess: () => void navigate("/purchasing/invoices") })}
              />
            </div>
          </>
        ) : null}
        {!result && post.isError && postErrorKey ? <p className="erp-auth-card__error">{t(postErrorKey)}</p> : null}
      </div>
    </div>
  );
}
