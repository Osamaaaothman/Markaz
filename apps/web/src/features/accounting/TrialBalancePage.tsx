import { useTranslation } from "react-i18next";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useTrialBalance, type TrialBalanceLine } from "./use-trial-balance";

export function TrialBalancePage(): React.JSX.Element {
  const { t } = useTranslation();
  const { data: currentUser } = useCurrentUser();
  const { data, isPending, isError, refetch } = useTrialBalance();

  const currency = currentUser?.companyDefaultCurrency ?? "SAR";

  if (isPending) {
    return <PageSkeleton />;
  }

  if (isError || !data) {
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
          <h1 className="erp-page__title">{t("accounting.trialBalance.title")}</h1>
          <p className="erp-page__subtitle">{t("accounting.trialBalance.subtitle")}</p>
        </div>
        <Tag
          value={data.isBalanced ? t("accounting.trialBalance.balanced") : t("accounting.trialBalance.outOfBalance")}
          severity={data.isBalanced ? "success" : "danger"}
        />
      </div>

      {data.lines.length === 0 ? (
        <p className="erp-page__empty">{t("accounting.trialBalance.empty")}</p>
      ) : (
        <DataTable value={[...data.lines]} className="erp-table" stripedRows size="small">
          <Column field="accountCode" header={t("accounting.trialBalance.account")} style={{ width: "8rem" }} />
          <Column field="accountName" header="" />
          <Column
            field="debitTotal"
            header={t("accounting.trialBalance.debit")}
            align="right"
            alignHeader="right"
            body={(line: TrialBalanceLine) => formatMoney(line.debitTotal, currency)}
          />
          <Column
            field="creditTotal"
            header={t("accounting.trialBalance.credit")}
            align="right"
            alignHeader="right"
            body={(line: TrialBalanceLine) => formatMoney(line.creditTotal, currency)}
          />
        </DataTable>
      )}

      <div className="erp-table-footer">
        <span>
          {t("accounting.trialBalance.totalDebit")}: <strong>{formatMoney(data.totalDebit, currency)}</strong>
        </span>
        <span>
          {t("accounting.trialBalance.totalCredit")}: <strong>{formatMoney(data.totalCredit, currency)}</strong>
        </span>
      </div>
    </div>
  );
}
