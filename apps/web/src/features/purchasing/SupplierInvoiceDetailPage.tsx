import { DocumentTrail } from "../documents/DocumentTrail";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { JournalEntryLinkButton } from "../accounting/JournalEntryLinkButton";
import { tafqeetAmount } from "@erp/shared";
import { useSupplierInvoice, type SupplierInvoiceLineDetail } from "./use-invoicing";
import { exportReport } from "../accounting/export-report";

// One supplier invoice (or debit note) as posted: what it was for, the tax on each line, what has been paid against it.
export function SupplierInvoiceDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { data: invoice, isPending, isError, refetch } = useSupplierInvoice(id);

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
  const money = (v: string): string => formatMoney(v, invoice.currency);
  const isInvoice = invoice.documentType === "INVOICE";

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{invoice.number}</h1>
          <p className="erp-page__subtitle">
            {localizedName({ name: invoice.supplierName, nameAr: invoice.supplierNameAr }, i18n.language)}
            {invoice.supplierInvoiceNumber ? ` · ${t("purchasing.invoices.supplierInvoiceNumber")}: ${invoice.supplierInvoiceNumber}` : ""}
          </p>
        </div>
        <div className="erp-page__header-actions">
          <Tag value={t(`purchasing.invoices.types.${invoice.documentType}`)} severity={isInvoice ? "info" : "warning"} />
          {invoice.outstanding !== null && Number(invoice.outstanding) > 0 ? <PermissionButton allowed={can("supplier_payment:create")} label={t("payments.recordPayment")} icon="pi pi-wallet" outlined onClick={() => void navigate(`/payments/supplier/new?party=${invoice.supplierId}`)} /> : null}
          <JournalEntryLinkButton entryId={invoice.journalEntryId} />
          <Button label={t("actions.exportPdf")} icon="pi pi-file-pdf" outlined onClick={() => void exportReport(`/v1/supplier-invoices/${invoice.id}/pdf`, { lang: i18n.language }, invoice.number, "pdf")} />
          <Button label={t("actions.print")} icon="pi pi-print" outlined onClick={() => void exportReport(`/v1/supplier-invoices/${invoice.id}/pdf`, { lang: i18n.language }, invoice.number, "print")} />
        </div>
      </div>

      <dl className="mk-facts">
        <div>
          <dt>{t("purchasing.invoices.invoiceDate")}</dt>
          <dd>{formatCalendarDate(invoice.invoiceDate, i18n.language)}</dd>
        </div>
        <div>
          <dt>{t("purchasing.invoices.dueDate")}</dt>
          <dd>{invoice.dueDate ? formatCalendarDate(invoice.dueDate, i18n.language) : "—"}</dd>
        </div>
        {invoice.purchaseOrderId ? (
          <div>
            <dt>{t("documents.purchaseOrder")}</dt>
            <dd>
              <button type="button" className="erp-button-link" onClick={() => void navigate(`/purchasing/orders/${invoice.purchaseOrderId}`)}>
                {invoice.purchaseOrderNumber}
              </button>
            </dd>
          </div>
        ) : null}
        {invoice.originalInvoiceId ? (
          <div>
            <dt>{t("documents.reducesInvoice")}</dt>
            <dd>
              <button type="button" className="erp-button-link" onClick={() => void navigate(`/purchasing/invoices/${invoice.originalInvoiceId}`)}>
                {invoice.originalInvoiceNumber}
              </button>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{t("purchasing.invoices.net")}</dt>
          <dd dir="ltr">{money(invoice.totalNet)}</dd>
        </div>
        <div>
          <dt>{t("purchasing.invoices.tax")}</dt>
          <dd dir="ltr">{money(invoice.totalTax)}</dd>
        </div>
        <div>
          <dt>{t("purchasing.invoices.gross")}</dt>
          <dd dir="ltr"><strong>{money(invoice.totalGross)}</strong></dd>
        </div>
        <div>
          <dt>{t("created.inWords")}</dt>
          <dd><strong>{tafqeetAmount(invoice.totalGross, invoice.currency)}</strong></dd>
        </div>
        {invoice.outstanding !== null ? (
          <div>
            <dt>{t("documents.outstanding")}</dt>
            <dd dir="ltr"><strong>{money(invoice.outstanding)}</strong></dd>
          </div>
        ) : null}
      </dl>
      {invoice.notes ? <p>{invoice.notes}</p> : null}

      <h3 className="erp-form__section-title">{t("purchasing.lines")}</h3>
      <DataTable value={[...invoice.lines]} className="erp-table" stripedRows showGridlines size="small">
        <Column
          header={t("documents.item")}
          body={(l: SupplierInvoiceLineDetail) =>
            l.kind === "PO_LINE" ? (
              <span>
                <span className="coa-code">{l.itemCode}</span> {localizedName({ name: l.itemName ?? "", nameAr: l.itemNameAr }, i18n.language)}
              </span>
            ) : (
              <span>
                <span className="coa-code">{l.accountCode}</span> {l.accountName ? localizedName({ name: l.accountName, nameAr: l.accountNameAr }, i18n.language) : ""}
                {l.description ? ` — ${l.description}` : ""}
              </span>
            )
          }
        />
        <Column header={t("purchasing.quantity")} align="right" body={(l: SupplierInvoiceLineDetail) => l.quantity} />
        <Column header={t("purchasing.unitPrice")} align="right" body={(l: SupplierInvoiceLineDetail) => money(l.unitPrice)} />
        <Column header={t("purchasing.invoices.net")} align="right" body={(l: SupplierInvoiceLineDetail) => money(l.netAmount)} />
        <Column header={t("documents.taxCode")} body={(l: SupplierInvoiceLineDetail) => `${l.taxCode} (${Number(l.taxRate)}%)`} />
        <Column header={t("purchasing.invoices.tax")} align="right" body={(l: SupplierInvoiceLineDetail) => money(l.taxAmount)} />
        <Column header={t("documents.priceVariance")} align="right" body={(l: SupplierInvoiceLineDetail) => (Number(l.priceVariance) === 0 ? "—" : money(l.priceVariance))} />
      </DataTable>

      {invoice.payments.length > 0 ? (
        <>
          <h3 className="erp-form__section-title">{t("documents.paymentsAgainst")}</h3>
          <DataTable value={[...invoice.payments]} className="erp-table" stripedRows showGridlines size="small">
            <Column header={t("purchasing.number")} body={(p: SupplierInvoiceDetailPayment) => <button type="button" className="erp-button-link coa-code" onClick={() => void navigate(`/payments/${p.paymentId}`)}>{p.number}</button>} />
            <Column header={t("purchasing.date")} body={(p: SupplierInvoiceDetailPayment) => formatCalendarDate(p.paymentDate, i18n.language)} />
            <Column header={t("created.amount")} align="right" body={(p: SupplierInvoiceDetailPayment) => money(p.amount)} />
          </DataTable>
        </>
      ) : null}

      {invoice.debitNotes.length > 0 ? (
        <>
          <h3 className="erp-form__section-title">{t("documents.debitNotesAgainst")}</h3>
          <DataTable value={[...invoice.debitNotes]} className="erp-table" stripedRows showGridlines size="small">
            <Column header={t("purchasing.number")} body={(d: { id: string; number: string; totalGross: string }) => <button type="button" className="erp-button-link" onClick={() => void navigate(`/purchasing/invoices/${d.id}`)}>{d.number}</button>} />
            <Column header={t("purchasing.invoices.gross")} align="right" body={(d: { id: string; number: string; totalGross: string }) => money(d.totalGross)} />
          </DataTable>
        </>
      ) : null}

      <div className="erp-form__actions">
        <Button type="button" label={t("documents.backToList")} text onClick={() => void navigate("/purchasing/invoices")} />
      </div>
    <DocumentTrail kind="supplier_invoice" id={id} />
    </div>
  );
}

type SupplierInvoiceDetailPayment = { paymentId: string; number: string; paymentDate: string; amount: string };
