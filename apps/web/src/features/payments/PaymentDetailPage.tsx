import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dialog } from "primereact/dialog";
import { Tag } from "primereact/tag";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { JournalEntryLinkButton } from "../accounting/JournalEntryLinkButton";
import { AttachmentsButton } from "../attachments/AttachmentsButton";
import { exportReport } from "../accounting/export-report";
import { usePayment, useReversePayment, type PaymentAllocationView } from "./use-payments";

// One receipt or payment as posted: who, how much, through which bank account, which invoices it settled and what stayed on account.
export function PaymentDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: payment, isPending, isError, refetch } = usePayment(id);
  const reversePayment = useReversePayment();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isPending) return <PageSkeleton />;
  if (isError || !payment) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }
  const money = (v: string): string => formatMoney(v, payment.currency);
  const invoicePath = (a: PaymentAllocationView): string => (a.invoiceKind === "SALES" ? `/sales/invoices/${a.invoiceId}` : `/purchasing/invoices/${a.invoiceId}`);
  const isVoided = payment.voidedAt !== null;

  function doReverse(): void {
    reversePayment.mutate(id, {
      onSuccess: (result) => {
        setConfirmOpen(false);
        void navigate(`/payments/${result.id}`);
      },
    });
  }

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{payment.number}</h1>
          <p className="erp-page__subtitle">{localizedName({ name: payment.partyName, nameAr: payment.partyNameAr }, i18n.language)}</p>
        </div>
        <div className="erp-page__header-actions">
          {isVoided ? (
            <Tag value={t("payments.voided")} severity="danger" />
          ) : (
            <Tag value={t(`payments.directions.${payment.direction}`)} severity={payment.direction === "RECEIPT" ? "success" : "info"} />
          )}
          <Button label={t("actions.print")} icon="pi pi-print" outlined onClick={() => void exportReport(`/v1/payments/${payment.id}/pdf`, { lang: i18n.language }, payment.number, "print")} />
          {!isVoided ? (
            <Button label={t("payments.reverse")} icon="pi pi-undo" severity="danger" outlined onClick={() => setConfirmOpen(true)} />
          ) : null}
          <AttachmentsButton ownerType="PAYMENT" ownerId={payment.id} label={payment.number} />
          <JournalEntryLinkButton entryId={payment.journalEntryId} />
        </div>
      </div>

      {payment.reversesPaymentId ? (
        <div className="erp-page__notice erp-page__notice--info">
          {t("payments.reversalOf")}{" "}
          <button type="button" className="erp-button-link" onClick={() => void navigate(`/payments/${payment.reversesPaymentId}`)}>
            {t("payments.viewOriginal")}
          </button>
        </div>
      ) : null}

      <dl className="mk-facts">
        <div>
          <dt>{t("payments.date")}</dt>
          <dd>{formatCalendarDate(payment.paymentDate, i18n.language)}</dd>
        </div>
        <div>
          <dt>{t("payments.method")}</dt>
          <dd>{t(`payments.methods.${payment.method}`)}</dd>
        </div>
        <div>
          <dt>{t("payments.bankAccount")}</dt>
          <dd>
            <span className="coa-code" dir="ltr">{payment.cashAccountCode}</span> {localizedName({ name: payment.cashAccountName, nameAr: payment.cashAccountNameAr }, i18n.language)}
          </dd>
        </div>
        <div>
          <dt>{t("payments.reference")}</dt>
          <dd dir="ltr">{payment.reference ?? "—"}</dd>
        </div>
        <div>
          <dt>{t("payments.amount")}</dt>
          <dd dir="ltr"><strong>{money(payment.amount)}</strong></dd>
        </div>
        <div>
          <dt>{t("payments.allocated")}</dt>
          <dd dir="ltr">{money(payment.allocated)}</dd>
        </div>
        <div>
          <dt>{t("payments.onAccount")}</dt>
          <dd dir="ltr">{money(payment.unallocated)}</dd>
        </div>
      </dl>
      {payment.notes ? <p>{payment.notes}</p> : null}

      <h3 className="erp-form__section-title">{t("documents.settledInvoices")}</h3>
      {payment.allocations.length > 0 ? (
        <DataTable value={[...payment.allocations]} className="erp-table" stripedRows showGridlines size="small">
          <Column header={t("purchasing.number")} body={(a: PaymentAllocationView) => <button type="button" className="erp-button-link coa-code" onClick={() => void navigate(invoicePath(a))}>{a.invoiceNumber}</button>} />
          <Column header={t("created.amount")} align="right" body={(a: PaymentAllocationView) => money(a.amount)} />
        </DataTable>
      ) : (
        <p className="erp-card__empty">{t("documents.noSettledInvoices")}</p>
      )}

      <div className="erp-form__actions">
        <Button type="button" label={t("documents.backToList")} text onClick={() => void navigate(payment.direction === "RECEIPT" ? "/payments/receipts" : "/payments/supplier")} />
      </div>

      <Dialog header={t("payments.reverseTitle")} visible={confirmOpen} onHide={() => setConfirmOpen(false)} className="erp-dialog" modal style={{ width: "min(32rem, 96vw)" }}>
        <p>{t("payments.confirmReverse")}</p>
        <div className="erp-form__actions">
          <Button label={t("actions.cancel")} text onClick={() => setConfirmOpen(false)} />
          <Button label={t("payments.reverse")} icon="pi pi-undo" severity="danger" loading={reversePayment.isPending} onClick={doReverse} />
        </div>
      </Dialog>
    </div>
  );
}
