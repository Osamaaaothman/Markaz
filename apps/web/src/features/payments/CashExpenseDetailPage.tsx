import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { JournalEntryLinkButton } from "../accounting/JournalEntryLinkButton";
import { exportReport } from "../accounting/export-report";
import { tafqeetAmount } from "@erp/shared";
import { useCashExpense, type CashExpenseLineDetail } from "./use-cash-expenses";

// One posted cash expense: which cash box it came out of, what it was spent on line by line,
// with the printable voucher and a link to the entry it posted.
export function CashExpenseDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: expense, isPending, isError, refetch } = useCashExpense(id);

  if (isPending) return <PageSkeleton />;
  if (isError || !expense) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }
  const money = (v: string): string => formatMoney(v, expense.currency);

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{expense.number}</h1>
          <p className="erp-page__subtitle">
            <span className="coa-code" dir="ltr">{expense.cashAccountCode}</span>{" "}
            {localizedName({ name: expense.cashAccountName, nameAr: expense.cashAccountNameAr }, i18n.language)}
          </p>
        </div>
        <div className="erp-page__header-actions">
          <Button label={t("actions.print")} icon="pi pi-print" outlined onClick={() => void exportReport(`/v1/cash-expenses/${expense.id}/pdf`, { lang: i18n.language }, expense.number, "print")} />
          <JournalEntryLinkButton entryId={expense.journalEntryId} />
        </div>
      </div>

      <dl className="mk-facts">
        <div>
          <dt>{t("cashExpenses.date")}</dt>
          <dd>{formatCalendarDate(expense.expenseDate, i18n.language)}</dd>
        </div>
        <div>
          <dt>{t("cashExpenses.cashAccount")}</dt>
          <dd>
            <span className="coa-code" dir="ltr">{expense.cashAccountCode}</span>{" "}
            {localizedName({ name: expense.cashAccountName, nameAr: expense.cashAccountNameAr }, i18n.language)}
          </dd>
        </div>
        <div>
          <dt>{t("payments.reference")}</dt>
          <dd dir="ltr">{expense.reference ?? "—"}</dd>
        </div>
        <div>
          <dt>{t("cashExpenses.description")}</dt>
          <dd>{expense.description ?? "—"}</dd>
        </div>
        <div>
          <dt>{t("cashExpenses.total")}</dt>
          <dd dir="ltr"><strong>{money(expense.amount)}</strong></dd>
        </div>
        <div>
          <dt>{t("created.inWords")}</dt>
          <dd><strong>{tafqeetAmount(expense.amount, expense.currency, i18n.language)}</strong></dd>
        </div>
      </dl>

      <h3 className="erp-form__section-title">{t("cashExpenses.lines")}</h3>
      <DataTable value={[...expense.lines]} className="erp-table" stripedRows showGridlines size="small">
        <Column
          header={t("cashExpenses.expenseAccount")}
          body={(line: CashExpenseLineDetail) => (
            <>
              <span className="coa-code" dir="ltr">{line.expenseAccountCode}</span>{" "}
              {localizedName({ name: line.expenseAccountName, nameAr: line.expenseAccountNameAr }, i18n.language)}
            </>
          )}
        />
        <Column header={t("cashExpenses.costCenter")} body={(line: CashExpenseLineDetail) => line.costCenterRef ?? "—"} />
        <Column header={t("cashExpenses.description")} body={(line: CashExpenseLineDetail) => line.description ?? "—"} />
        <Column header={t("created.amount")} align="right" body={(line: CashExpenseLineDetail) => money(line.amount)} />
      </DataTable>

      <div className="erp-form__actions">
        <Button type="button" label={t("documents.backToList")} text onClick={() => void navigate("/payments/cash-expenses")} />
      </div>
    </div>
  );
}
