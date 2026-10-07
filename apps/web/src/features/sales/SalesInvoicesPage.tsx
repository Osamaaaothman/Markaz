import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
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
import { useCreateCreditNote, useSalesInvoice, useSalesInvoices, type SalesInvoiceSummary } from "./use-sales";

const ALL = "ALL";
const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;

export function SalesInvoicesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [type, setType] = useState<"INVOICE" | "CREDIT_NOTE" | null>(null);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useSalesInvoices(type);
  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("sales.invoices.title")}</h1>
          <p className="erp-page__subtitle">{t("sales.invoices.subtitle")}</p>
        </div>
        <PermissionButton allowed={can("sales_invoice:create")} label={t("sales.invoices.new")} icon="pi pi-plus" onClick={() => void navigate("/sales/invoices/new")} />
      </div>

      <div className="coa-toolbar">
        <div className="coa-levels">
          <span className="coa-levels__label">{t("sales.invoices.documentType")}</span>
          <Dropdown
            value={type ?? ALL}
            onChange={(e) => setType(e.value === ALL ? null : (e.value as "INVOICE" | "CREDIT_NOTE"))}
            options={[
              { label: t("sales.invoices.allTypes"), value: ALL },
              { label: t("sales.invoices.types.INVOICE"), value: "INVOICE" },
              { label: t("sales.invoices.types.CREDIT_NOTE"), value: "CREDIT_NOTE" },
            ]}
          />
        </div>
      </div>

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
          <DataTable value={rows} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")} selectionMode="single" onRowClick={(e) => void navigate(`/sales/invoices/${(e.data as SalesInvoiceSummary).id}`)}>
            <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(r: SalesInvoiceSummary) => <span className="coa-code">{r.number}</span>} />
            <Column header={t("sales.invoices.documentType")} style={{ width: "10rem" }} body={(r: SalesInvoiceSummary) => <Tag value={t(`sales.invoices.types.${r.documentType}`)} severity={r.documentType === "INVOICE" ? "info" : "warning"} />} />
            <Column header={t("sales.customer")} body={(r: SalesInvoiceSummary) => localizedName({ name: r.customerName, nameAr: r.customerNameAr }, i18n.language)} />
            <Column header={t("purchasing.invoices.invoiceDate")} style={{ width: "9rem" }} body={(r: SalesInvoiceSummary) => formatCalendarDate(r.invoiceDate, i18n.language)} />
            <Column header={t("purchasing.invoices.dueDate")} style={{ width: "9rem" }} body={(r: SalesInvoiceSummary) => (r.dueDate ? formatCalendarDate(r.dueDate, i18n.language) : "")} />
            <Column header={t("purchasing.invoices.net")} align="right" body={(r: SalesInvoiceSummary) => formatMoney(r.totalNet, r.currency)} />
            <Column header={t("purchasing.invoices.tax")} align="right" body={(r: SalesInvoiceSummary) => formatMoney(r.totalTax, r.currency)} />
            <Column header={t("purchasing.invoices.gross")} align="right" body={(r: SalesInvoiceSummary) => <strong>{formatMoney(r.totalGross, r.currency)}</strong>} />
          </DataTable>
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
          <Tag value={t(`sales.invoices.types.${invoice.documentType}`)} severity={invoice.documentType === "INVOICE" ? "info" : "warning"} />
          <Button label={t("sales.invoices.downloadPdf")} icon="pi pi-file-pdf" outlined onClick={() => void exportReport(`/v1/sales-invoices/${invoice.id}/pdf`, { lang: i18n.language }, invoice.number, "pdf")} />
          {invoice.documentType === "INVOICE" ? <PermissionButton allowed={can("credit_note:create")} label={t("sales.invoices.creditNote")} icon="pi pi-minus-circle" outlined onClick={() => setCreditOpen(true)} /> : null}
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
      <DataTable value={[...invoice.lines]} className="erp-table" stripedRows showGridlines size="small">
        <Column header={t("sales.description")} body={(l: (typeof invoice.lines)[number]) => l.description} />
        <Column header={t("purchasing.quantity")} align="right" body={(l: (typeof invoice.lines)[number]) => l.quantity} />
        <Column header={t("purchasing.unitPrice")} align="right" body={(l: (typeof invoice.lines)[number]) => formatMoney(l.unitPrice, invoice.currency)} />
        <Column header={t("purchasing.invoices.net")} align="right" body={(l: (typeof invoice.lines)[number]) => formatMoney(l.netAmount, invoice.currency)} />
        <Column header={t("purchasing.invoices.tax")} align="right" body={(l: (typeof invoice.lines)[number]) => `${formatMoney(l.taxAmount, invoice.currency)} (${Number(l.taxRate)}%)`} />
      </DataTable>
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
      </div>
      <div className="erp-form__actions">
        <Button type="button" label={t("sales.orders.back")} text onClick={() => void navigate("/sales/invoices")} />
      </div>
      <CreditNoteDialog invoiceId={invoice.id} visible={creditOpen} onHide={() => setCreditOpen(false)} />
    </div>
  );
}

function CreditNoteDialog({ invoiceId, visible, onHide }: { invoiceId: string; visible: boolean; onHide: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const { data: taxCodes } = useTaxCodes(false);
  const create = useCreateCreditNote(invoiceId);
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
    <Dialog header={t("sales.invoices.creditNote")} visible={visible} onHide={onHide} className="erp-dialog" modal style={{ width: "min(40rem, 96vw)" }}>
      <div className="erp-form">
        <p className="erp-field__hint">{t("sales.invoices.creditNoteHint")}</p>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="cnDate">{t("sales.invoices.creditDate")}</label>
            <Calendar inputId="cnDate" value={date} onChange={(e) => e.value && setDate(e.value)} dateFormat="yy-mm-dd" />
          </div>
        </div>
        <div className="erp-field">
          <label htmlFor="cnDesc">{t("sales.description")}</label>
          <InputText id="cnDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="cnQty">{t("purchasing.quantity")}</label>
            <InputText id="cnQty" dir="ltr" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="erp-field">
            <label htmlFor="cnPrice">{t("purchasing.unitPrice")}</label>
            <InputText id="cnPrice" dir="ltr" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
          </div>
          <div className="erp-field">
            <label htmlFor="cnTax">{t("purchasing.invoices.taxCode")}</label>
            <Dropdown inputId="cnTax" value={taxCodeId || null} onChange={(e) => setTaxCodeId((e.value as string | null) ?? "")} options={(taxCodes ?? []).map((c) => ({ label: c.code, value: c.id }))} />
          </div>
        </div>
        {create.isError ? <p className="erp-auth-card__error">{code === "CREDIT_EXCEEDS_INVOICE" ? t("sales.errors.CREDIT_EXCEEDS_INVOICE") : t("sales.errors.generic")}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
          <Button
            type="button"
            label={t("sales.invoices.postCreditNote")}
            disabled={!valid}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { creditDate: toDateOnlyIsoString(date), lines: [{ description: description.trim(), quantity, unitPrice, taxCodeId }] },
                { onSuccess: onHide },
              )
            }
          />
        </div>
      </div>
    </Dialog>
  );
}
