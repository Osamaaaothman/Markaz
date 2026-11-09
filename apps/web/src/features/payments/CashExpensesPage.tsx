import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataGrid } from "../../shared/ui/DataGrid";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useCashExpenses, type CashExpenseSummary } from "./use-cash-expenses";

export function CashExpensesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useCashExpenses();
  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("cashExpenses.title")}</h1>
          <p className="erp-page__subtitle">{t("cashExpenses.subtitle")}</p>
        </div>
        <div className="erp-page__header-actions">
          <PermissionButton allowed={can("cash_expense:create")} label={t("cashExpenses.new")} icon="pi pi-plus" onClick={() => void navigate("/payments/cash-expenses/new")} />
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
          <DataGrid emptyAction={{ allowed: can("cash_expense:create"), label: t("cashExpenses.new"), onClick: () => void navigate("/payments/cash-expenses/new") }} value={rows} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
            <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(r: CashExpenseSummary) => <span className="coa-code">{r.number}</span>} />
            <Column header={t("cashExpenses.date")} style={{ width: "9rem" }} body={(r: CashExpenseSummary) => formatCalendarDate(r.expenseDate, i18n.language)} />
            <Column header={t("cashExpenses.cashAccount")} body={(r: CashExpenseSummary) => `${r.cashAccountCode} — ${localizedName({ name: r.cashAccountName, nameAr: r.cashAccountNameAr }, i18n.language)}`} />
            <Column header={t("cashExpenses.expenseAccount")} body={(r: CashExpenseSummary) => `${r.expenseAccountCode} — ${localizedName({ name: r.expenseAccountName, nameAr: r.expenseAccountNameAr }, i18n.language)}`} />
            <Column header={t("cashExpenses.description")} body={(r: CashExpenseSummary) => r.description ?? ""} />
            <Column header={t("payments.reference")} body={(r: CashExpenseSummary) => r.reference ?? ""} />
            <Column header={t("created.amount")} align="right" body={(r: CashExpenseSummary) => <strong>{formatMoney(r.amount, r.currency)}</strong>} />
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
