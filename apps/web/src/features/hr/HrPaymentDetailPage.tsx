import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Tag } from "primereact/tag";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { JournalEntryLinkButton } from "../accounting/JournalEntryLinkButton";
import { useHrPayment } from "./use-hr-payments";

// One salary, social insurance or end-of-service payment as posted.
export function HrPaymentDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: payment, isPending, isError, refetch } = useHrPayment(id);

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

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{payment.number}</h1>
          <p className="erp-page__subtitle">{payment.employeeName ? localizedName({ name: payment.employeeName, nameAr: payment.employeeNameAr }, i18n.language) : (payment.payrollRunNumber ?? "")}</p>
        </div>
        <div className="erp-page__header-actions">
          <Tag value={t(`hr.payments.kinds.${payment.kind}`)} severity={payment.kind === "SALARY" ? "success" : payment.kind === "GOSI" ? "info" : "warning"} />
          <JournalEntryLinkButton entryId={payment.journalEntryId} />
        </div>
      </div>

      <dl className="mk-facts">
        <div>
          <dt>{t("payments.date")}</dt>
          <dd>{formatCalendarDate(payment.paymentDate, i18n.language)}</dd>
        </div>
        <div>
          <dt>{t("payments.bankAccount")}</dt>
          <dd>
            <span className="coa-code" dir="ltr">{payment.cashAccountCode}</span> {localizedName({ name: payment.cashAccountName, nameAr: payment.cashAccountNameAr }, i18n.language)}
          </dd>
        </div>
        {payment.payrollRunId ? (
          <div>
            <dt>{t("hr.payments.run")}</dt>
            <dd>
              <button type="button" className="erp-button-link" onClick={() => void navigate(`/hr/payroll-runs/${payment.payrollRunId}`)}>
                {payment.payrollRunNumber}
              </button>
            </dd>
          </div>
        ) : null}
        {payment.settlementNumber ? (
          <div>
            <dt>{t("hr.payments.settlement")}</dt>
            <dd>{payment.settlementNumber}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t("payments.amount")}</dt>
          <dd dir="ltr"><strong>{money(payment.amount)}</strong></dd>
        </div>
      </dl>
      {payment.notes ? <p>{payment.notes}</p> : null}

      {payment.items.length > 0 ? (
        <>
          <h3 className="erp-form__section-title">{t("hr.payments.employees")}</h3>
          <DataTable value={[...payment.items]} className="erp-table" stripedRows showGridlines size="small">
            <Column header={t("hr.employees.name")} body={(i: (typeof payment.items)[number]) => <button type="button" className="erp-button-link" onClick={() => void navigate(`/hr/employees/${i.employeeId}`)}>{localizedName({ name: i.employeeName, nameAr: i.employeeNameAr }, i18n.language)}</button>} />
            <Column header={t("created.amount")} align="right" body={(i: (typeof payment.items)[number]) => money(i.amount)} />
          </DataTable>
        </>
      ) : null}

      <div className="erp-form__actions">
        <Button type="button" label={t("documents.backToList")} text onClick={() => void navigate("/hr/payments")} />
      </div>
    </div>
  );
}
