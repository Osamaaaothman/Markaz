import { useAllWarehouses } from "../inventory/use-warehouses";
import { positiveReturnQuantity, validReturnQuantity } from "../../shared/lib/return-quantity";
import { DocumentTrail } from "../documents/DocumentTrail";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { selectFilter } from "../../shared/ui/column-filters";
import { DataGrid } from "../../shared/ui/DataGrid";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate, toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { exportReport } from "../accounting/export-report";
import { useTaxCodes } from "../purchasing/use-invoicing";
import { newId, tafqeetAmount } from "@erp/shared";
import { useCreateCreditNote, useCreateDebitNote, useSalesInvoice, useSalesInvoices, type SalesInvoiceDetail, type SalesInvoiceSummary } from "./use-sales";
import { AttachmentsButton } from "../attachments/AttachmentsButton";
import { ZatcaInvoicePanel } from "../compliance/ZatcaInvoicePanel";

const ALL = "ALL";
const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;

function documentTypeSeverity(documentType: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE"): "info" | "warning" | "danger" {
  if (documentType === "INVOICE") return "info";
  if (documentType === "CREDIT_NOTE") return "warning";
  return "danger";
}

export function SalesInvoicesPage({ returnsOnly = false }: { returnsOnly?: boolean }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [type, setType] = useState<"INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE" | null>(null);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useSalesInvoices(returnsOnly ? "CREDIT_NOTE" : type);
  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t(returnsOnly ? "returns.salesTitle" : "sales.invoices.title")}</h1>
          <p className="erp-page__subtitle">{t("sales.invoices.subtitle")}</p>
        </div>
        {returnsOnly ? <Button label={t("returns.new")} icon="pi pi-plus" onClick={() => void navigate("/sales/invoices")} /> : <PermissionButton allowed={can("sales_invoice:create")} label={t("sales.invoices.new")} icon="pi pi-plus" onClick={() => void navigate("/sales/invoices/new")} />}
      </div>

      {!returnsOnly ? <div className="coa-toolbar">
        <div className="coa-levels">
          <span className="coa-levels__label">{t("sales.invoices.documentType")}</span>
          <Dropdown
            value={type ?? ALL}
            onChange={(e) => setType(e.value === ALL ? null : (e.value as "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE"))}
            options={[
              { label: t("sales.invoices.allTypes"), value: ALL },
              { label: t("sales.invoices.types.INVOICE"), value: "INVOICE" },
              { label: t("sales.invoices.types.CREDIT_NOTE"), value: "CREDIT_NOTE" },
              { label: t("sales.invoices.types.DEBIT_NOTE"), value: "DEBIT_NOTE" },
            ]}
          />
        </div>
      </div> : null}

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
        <>
          <DataGrid emptyAction={{ allowed: !returnsOnly && can("sales_invoice:create"), label: t("sales.invoices.new"), onClick: () => void navigate("/sales/invoices/new") }} value={rows} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")} selectionMode="single" onRowClick={(e) => void navigate(`/sales/invoices/${(e.data as SalesInvoiceSummary).id}`)}>
            <Column field="number" filter header={t("purchasing.number")} style={{ width: "13rem" }} body={(r: SalesInvoiceSummary) => <span className="coa-code">{r.number}</span>} />
            <Column field="documentType" filter filterMatchMode="equals" filterElement={selectFilter((["INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"] as const).map((v) => ({ label: t(`sales.invoices.types.${v}`), value: v })), t("table.filterPlaceholder"))} header={t("sales.invoices.documentType")} style={{ width: "10rem" }} body={(r: SalesInvoiceSummary) => <Tag value={t(`sales.invoices.types.${r.documentType}`)} severity={documentTypeSeverity(r.documentType)} />} />
            <Column header={t("sales.customer")} body={(r: SalesInvoiceSummary) => localizedName({ name: r.customerName, nameAr: r.customerNameAr }, i18n.language)} />
            <Column header={t("purchasing.invoices.invoiceDate")} style={{ width: "9rem" }} body={(r: SalesInvoiceSummary) => formatCalendarDate(r.invoiceDate, i18n.language)} />
            <Column header={t("purchasing.invoices.dueDate")} style={{ width: "9rem" }} body={(r: SalesInvoiceSummary) => (r.dueDate ? formatCalendarDate(r.dueDate, i18n.language) : "")} />
            <Column header={t("purchasing.invoices.net")} align="right" body={(r: SalesInvoiceSummary) => formatMoney(r.totalNet, r.currency)} />
            <Column header={t("purchasing.invoices.tax")} align="right" body={(r: SalesInvoiceSummary) => formatMoney(r.totalTax, r.currency)} />
            <Column header={t("purchasing.invoices.gross")} align="right" body={(r: SalesInvoiceSummary) => <strong>{formatMoney(r.totalGross, r.currency)}</strong>} />
            <Column header="" style={{ width: "4rem" }} body={(r: SalesInvoiceSummary) => <AttachmentsButton ownerType="SALES_INVOICE" ownerId={r.id} label={r.number} />} />
          </DataGrid>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function SalesInvoiceDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { data: invoice, isPending, isError, refetch } = useSalesInvoice(id);
  const [creditOpen, setCreditOpen] = useState(false);
  const [debitOpen, setDebitOpen] = useState(false);

  if (isPending) return <PageSkeleton />;
  if (isError || !invoice) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{invoice.number}</h1>
          <p className="erp-page__subtitle">{localizedName({ name: invoice.customerName, nameAr: invoice.customerNameAr }, i18n.language)}</p>
        </div>
        <div className="erp-page__header-actions">
          <Tag value={t(`sales.invoices.types.${invoice.documentType}`)} severity={documentTypeSeverity(invoice.documentType)} />
          <AttachmentsButton ownerType="SALES_INVOICE" ownerId={invoice.id} label={invoice.number} />
          <Button label={t("sales.invoices.downloadPdf")} icon="pi pi-file-pdf" outlined onClick={() => void exportReport(`/v1/sales-invoices/${invoice.id}/pdf`, { lang: i18n.language }, invoice.number, "pdf")} />
          <Button label={t("actions.print")} icon="pi pi-print" outlined onClick={() => void exportReport(`/v1/sales-invoices/${invoice.id}/pdf`, { lang: i18n.language }, invoice.number, "print")} />
          {invoice.documentType === "INVOICE" ? <PermissionButton allowed={can("credit_note:create")} label={t("sales.invoices.salesReturn")} icon="pi pi-minus-circle" outlined onClick={() => setCreditOpen(true)} /> : null}
          {invoice.documentType === "INVOICE" ? <PermissionButton allowed={can("debit_note:create")} label={t("sales.invoices.debitNote")} icon="pi pi-plus-circle" outlined onClick={() => setDebitOpen(true)} /> : null}
          {invoice.documentType === "INVOICE" ? <PermissionButton allowed={can("customer_receipt:create")} label={t("payments.recordPayment")} icon="pi pi-wallet" outlined onClick={() => void navigate(`/payments/receipts/new?party=${invoice.customerId}`)} /> : null}
          {invoice.originalInvoiceId ? <Button label={t("sales.invoices.openOriginal")} text onClick={() => void navigate(`/sales/invoices/${invoice.originalInvoiceId}`)} /> : null}
        </div>
      </div>
      <div className="erp-form__row">
        <div className="erp-field">
          <label>{t("purchasing.invoices.invoiceDate")}</label>
          <span>{formatCalendarDate(invoice.invoiceDate, i18n.language)}</span>
        </div>
        <div className="erp-field">
          <label>{t("purchasing.invoices.dueDate")}</label>
          <span>{invoice.dueDate ? formatCalendarDate(invoice.dueDate, i18n.language) : "—"}</span>
        </div>
      </div>
      {invoice.notes ? <p>{invoice.notes}</p> : null}
      <DataGrid value={[...invoice.lines]} searchable={false} className="erp-table" stripedRows showGridlines size="small">
        <Column header={t("sales.description")} body={(l: (typeof invoice.lines)[number]) => l.description} />
        <Column header={t("purchasing.quantity")} align="right" body={(l: (typeof invoice.lines)[number]) => l.quantity} />
        <Column header={t("purchasing.unitPrice")} align="right" body={(l: (typeof invoice.lines)[number]) => formatMoney(l.unitPrice, invoice.currency)} />
        <Column header={t("purchasing.invoices.net")} align="right" body={(l: (typeof invoice.lines)[number]) => formatMoney(l.netAmount, invoice.currency)} />
        <Column header={t("purchasing.invoices.tax")} align="right" body={(l: (typeof invoice.lines)[number]) => `${formatMoney(l.taxAmount, invoice.currency)} (${Number(l.taxRate)}%)`} />
      </DataGrid>
      <div className="erp-table-footer">
        <span>
          {t("purchasing.invoices.net")}: <strong>{formatMoney(invoice.totalNet, invoice.currency)}</strong>
        </span>
        <span>
          {t("purchasing.invoices.tax")}: <strong>{formatMoney(invoice.totalTax, invoice.currency)}</strong>
        </span>
        <span>
          {t("purchasing.invoices.gross")}: <strong>{formatMoney(invoice.totalGross, invoice.currency)}</strong>
        </span>
        <span>
          {t("created.inWords")}: <strong>{tafqeetAmount(invoice.totalGross, invoice.currency)}</strong>
        </span>
      </div>
      <ZatcaInvoicePanel salesInvoiceId={invoice.id} resubmitEnabled={false} />

      <div className="erp-form__actions">
        <Button type="button" label={t("sales.orders.back")} text onClick={() => void navigate("/sales/invoices")} />
      </div>
      <SalesReturnDialog invoiceId={invoice.id} visible={creditOpen} onHide={() => setCreditOpen(false)} />
      <DebitNoteDialog invoiceId={invoice.id} visible={debitOpen} onHide={() => setDebitOpen(false)} />
    <DocumentTrail kind="sales_invoice" id={id} />
    </div>
  );
}

type SalesReturnLineRow = SalesInvoiceDetail["lines"][number] & {
  included: boolean;
  returnQty: string;
  taxCodeId: string;
};

function SalesReturnDialog({ invoiceId, visible, onHide }: { invoiceId: string; visible: boolean; onHide: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: invoice, isError: loadError, refetch } = useSalesInvoice(invoiceId);
  const { data: warehouses, isPending: warehousesPending, isError: warehousesError, refetch: refetchWarehouses } = useAllWarehouses();
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [submissionKey, setSubmissionKey] = useState(newId);
  const create = useCreateCreditNote(invoiceId, submissionKey);
  const [date, setDate] = useState<Date>(new Date());
  const [rows, setRows] = useState<SalesReturnLineRow[]>([]);

  useEffect(() => {
    if (!visible || !invoice?.lines) return;
    create.reset();
    setDate(new Date());
    setNotes("");
    setWarehouseId("");
    setSubmissionKey(newId());
    setRows(
      invoice.lines.map((l) => ({
        ...l,
        included: positiveReturnQuantity(l.returnableQuantity),
        returnQty: l.returnableQuantity,
      })),
    );
  }, [visible, invoice?.lines]);

  const updateRow = (idx: number, patch: Partial<SalesReturnLineRow>) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const selectedRows = rows.filter((r) => r.included);
  const needsWarehouse = selectedRows.some((r) => r.itemId !== null);
  const valid = (!needsWarehouse || (warehouses ?? []).some((w) => w.id === warehouseId && w.isActive)) && selectedRows.length > 0 && selectedRows.every((r) => validReturnQuantity(r.returnQty, r.returnableQuantity)) && !create.isPending;

  const handlePost = () => {
    if (!valid) return;
    create.mutate(
      {
        creditDate: toDateOnlyIsoString(date),
        notes,
        lines: selectedRows.map((r) => ({
          originalLineId: r.id,
          ...(r.itemId ? { warehouseId } : {}),
          description: r.description,
          quantity: r.returnQty,
          unitPrice: r.unitPrice,
          taxCodeId: r.taxCodeId,
        })),
      },
      { onSuccess: (result) => { onHide(); void navigate(`/sales/invoices/${result.id}`); } },
    );
  };

  const currency = invoice?.currency ?? "";
  const code = (create.error as { response?: { data?: { error?: { code?: string } } } } | null)?.response?.data?.error?.code;

  return (
    <Dialog header={t("sales.invoices.salesReturn")} visible={visible} onHide={onHide} className="erp-dialog erp-dialog--wide" modal style={{ width: "min(64rem, 96vw)" }}>
      {loadError ? <div role="alert"><p>{t("status.error")}</p><Button label={t("actions.retry")} onClick={() => void refetch()} /></div> : !invoice ? (
        <PageSkeleton />
      ) : (
        <div className="erp-form">
          <p className="erp-field__hint">{t("sales.invoices.salesReturnHint")}</p>
          <div className="erp-form__row">
            <div className="erp-field">
              <label htmlFor="srDate">{t("sales.invoices.creditDate")}</label>
              <Calendar inputId="srDate" value={date} onChange={(e) => e.value && setDate(e.value)} dateFormat="yy-mm-dd" />
            </div>
          </div>
          {rows.some((r) => r.itemId !== null) ? <div className="erp-field">
            <label htmlFor="srWarehouse">{t("returns.destinationWarehouse")}</label>
            <Dropdown inputId="srWarehouse" value={warehouseId || null}
              onChange={(e) => setWarehouseId((e.value as string | null) ?? "")}
              options={(warehouses ?? []).filter((w) => w.isActive).map((w) => ({ label: w.code + " — " + localizedName(w, i18n.language), value: w.id }))}
              placeholder={t("returns.chooseWarehouse")} filter showClear
              disabled={create.isPending || warehousesPending} />
            {warehousesError ? <div role="alert"><span>{t("status.error")}</span><Button label={t("actions.retry")} text onClick={() => void refetchWarehouses()} /></div> : null}
          </div> : null}
          <div className="erp-field"><label htmlFor="srNotes">{t("purchasing.returns.reason")}</label><InputText id="srNotes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></div>
          <DataTable value={rows} className="erp-table" size="small" showGridlines>
            <Column
              header=""
              style={{ width: "2.5rem" }}
              body={(_: SalesReturnLineRow, opt) => (
                <input
                  type="checkbox"
                  disabled={!positiveReturnQuantity(rows[opt.rowIndex]?.returnableQuantity ?? "0") || create.isPending}
                  aria-label={t("documents.item")}
                  checked={rows[opt.rowIndex]?.included ?? false}
                  onChange={(e) => updateRow(opt.rowIndex, { included: e.target.checked })}
                />
              )}
            />
            <Column header={t("sales.description")} body={(r: SalesReturnLineRow) => r.description} />
            <Column header={t("returns.remaining")} align="right" body={(r: SalesReturnLineRow) => r.returnableQuantity} />
            <Column header={t("purchasing.invoices.origQty")} align="right" style={{ width: "6rem" }} body={(r: SalesReturnLineRow) => r.quantity} />
            <Column
              header={t("purchasing.invoices.returnQty")}
              style={{ width: "8rem" }}
              body={(r: SalesReturnLineRow, opt) => (
                <InputText
                  disabled={!rows[opt.rowIndex]?.included}
                  dir="ltr"
                  value={rows[opt.rowIndex]?.returnQty ?? ""}
                  style={{ width: "100%" }}
                  onChange={(e) => updateRow(opt.rowIndex, { returnQty: e.target.value })}
                  className={rows[opt.rowIndex]?.included && !validReturnQuantity(rows[opt.rowIndex]?.returnQty ?? "", r.returnableQuantity) ? "p-invalid" : ""}
                />
              )}
            />
            <Column header={t("purchasing.unitPrice")} align="right" style={{ width: "9rem" }} body={(r: SalesReturnLineRow) => formatMoney(r.unitPrice, currency)} />
            <Column header={t("purchasing.invoices.taxCode")} body={(r: SalesReturnLineRow) => `${r.taxRate}%`} />
          </DataTable>
          {create.isError ? <p className="erp-auth-card__error">{t(`returns.errors.${code ?? "generic"}`, { defaultValue: t("returns.errors.generic") })}</p> : null}
          <div className="erp-form__actions">
            <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
            <Button type="button" label={t("sales.invoices.postCreditNote")} disabled={!valid} loading={create.isPending} onClick={handlePost} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

function DebitNoteDialog({ invoiceId, visible, onHide }: { invoiceId: string; visible: boolean; onHide: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const { data: taxCodes } = useTaxCodes(false);
  const create = useCreateDebitNote(invoiceId);
  const [date, setDate] = useState<Date>(new Date());
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [taxCodeId, setTaxCodeId] = useState("");

  useEffect(() => {
    if (!visible) return;
    create.reset();
    setDate(new Date());
    setDescription("");
    setQuantity("1");
    setUnitPrice("");
    setTaxCodeId((taxCodes?.find((c) => c.treatment === "STANDARD") ?? taxCodes?.[0])?.id ?? "");
    // Reset each time the dialog opens.
  }, [visible]);

  const valid = description.trim() !== "" && DECIMAL.test(quantity) && /[1-9]/.test(quantity) && DECIMAL.test(unitPrice) && taxCodeId !== "";
  const code = (create.error as { response?: { data?: { error?: { code?: string } } } } | null)?.response?.data?.error?.code;

  return (
    <Dialog header={t("sales.invoices.debitNote")} visible={visible} onHide={onHide} className="erp-dialog" modal style={{ width: "min(40rem, 96vw)" }}>
      <div className="erp-form">
        <p className="erp-field__hint">{t("sales.invoices.debitNoteHint")}</p>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="dnDate">{t("sales.invoices.debitDate")}</label>
            <Calendar inputId="dnDate" value={date} onChange={(e) => e.value && setDate(e.value)} dateFormat="yy-mm-dd" />
          </div>
        </div>
        <div className="erp-field">
          <label htmlFor="dnDesc">{t("sales.description")}</label>
          <InputText id="dnDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="dnQty">{t("purchasing.quantity")}</label>
            <InputText id="dnQty" dir="ltr" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="erp-field">
            <label htmlFor="dnPrice">{t("purchasing.unitPrice")}</label>
            <InputText id="dnPrice" dir="ltr" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
          </div>
          <div className="erp-field">
            <label htmlFor="dnTax">{t("purchasing.invoices.taxCode")}</label>
            <Dropdown inputId="dnTax" value={taxCodeId || null} onChange={(e) => setTaxCodeId((e.value as string | null) ?? "")} options={(taxCodes ?? []).map((c) => ({ label: c.code, value: c.id }))} />
          </div>
        </div>
        {create.isError ? <p className="erp-auth-card__error">{code === "DEBIT_EXCEEDS_INVOICE" ? t("sales.errors.DEBIT_EXCEEDS_INVOICE") : t("sales.errors.generic")}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
          <Button
            type="button"
            label={t("sales.invoices.postDebitNote")}
            disabled={!valid}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { debitDate: toDateOnlyIsoString(date), lines: [{ description: description.trim(), quantity, unitPrice, taxCodeId }] },
                { onSuccess: onHide },
              )
            }
          />
        </div>
      </div>
    </Dialog>
  );
}
