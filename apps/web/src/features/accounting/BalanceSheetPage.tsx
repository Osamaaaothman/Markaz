import { useTranslation } from "react-i18next";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { ExportButtons } from "../../shared/ui/ExportButtons";
import { exportReport, type ExportFormat } from "./export-report";
import { useAccountLabel } from "./use-account-label";
import { useBalanceSheet, type BalanceSheetLine } from "./use-balance-sheet";

export function BalanceSheetPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data: currentUser } = useCurrentUser();
  const { data, isPending, isError, refetch } = useBalanceSheet();

  const handleExport = (format: ExportFormat) =>
    exportReport("/v1/balance-sheet/export", { lang: i18n.language }, "balance-sheet", format);

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

  const hasActivity = data.assets.lines.length > 0 || data.liabilities.lines.length > 0 || data.equity.lines.length > 0;

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("accounting.balanceSheet.title")}</h1>
          <p className="erp-page__subtitle">{t("accounting.balanceSheet.subtitle")}</p>
        </div>
        <div className="erp-page__header-actions">
          <Tag
            value={data.isBalanced ? t("accounting.balanceSheet.balanced") : t("accounting.balanceSheet.outOfBalance")}
            severity={data.isBalanced ? "success" : "danger"}
          />
          <ExportButtons onExport={handleExport} />
        </div>
      </div>

      {!hasActivity ? (
        <p className="erp-page__empty">{t("accounting.balanceSheet.empty")}</p>
      ) : (
        <>
          <section className="erp-statement-section">
            <h2 className="erp-form__section-title">{t("accounting.balanceSheet.assets")}</h2>
            <BalanceSheetTable lines={data.assets.lines} currency={currency} />
            <div className="erp-table-footer">
              <span>
                {t("accounting.balanceSheet.totalAssets")}: <strong>{formatMoney(data.assets.total, currency)}</strong>
              </span>
            </div>
          </section>

          <section className="erp-statement-section">
            <h2 className="erp-form__section-title">{t("accounting.balanceSheet.liabilities")}</h2>
            <BalanceSheetTable lines={data.liabilities.lines} currency={currency} />
            <div className="erp-table-footer">
              <span>
                {t("accounting.balanceSheet.totalLiabilities")}: <strong>{formatMoney(data.liabilities.total, currency)}</strong>
              </span>
            </div>
          </section>

          <section className="erp-statement-section">
            <h2 className="erp-form__section-title">{t("accounting.balanceSheet.equity")}</h2>
            <BalanceSheetTable
              lines={[
                ...data.equity.lines,
                {
                  accountId: "current-year-earnings",
                  accountCode: "",
                  accountName: t("accounting.balanceSheet.currentYearEarnings"),
                  balance: data.currentYearEarnings,
                },
              ]}
              currency={currency}
            />
            <div className="erp-table-footer">
              <span>
                {t("accounting.balanceSheet.totalEquity")}: <strong>{formatMoney(data.totalEquity, currency)}</strong>
              </span>
            </div>
          </section>

          <div className="erp-table-footer erp-table-footer--center">
            <span>
              {t("accounting.balanceSheet.totalLiabilitiesAndEquity")}:{" "}
              <strong>{formatMoney(data.totalLiabilitiesAndEquity, currency)}</strong>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function BalanceSheetTable({
  lines,
  currency,
}: {
  readonly lines: readonly BalanceSheetLine[];
  readonly currency: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const accountLabel = useAccountLabel();
  return (
    <DataTable
      value={[...lines]}
      className="erp-table"
      stripedRows
      showGridlines
      size="small"
      emptyMessage={t("status.empty")}
    >
      <Column
        field="accountName"
        header={t("accounting.trialBalance.account")}
        body={(line: BalanceSheetLine) => (
          <span className="erp-table__account">
            {line.accountCode ? <span className="erp-table__account-code">{line.accountCode}</span> : null}
            <span className="erp-table__account-name">{accountLabel(line.accountId, line.accountName)}</span>
          </span>
        )}
      />
      <Column
        field="balance"
        header={t("accounting.balanceSheet.balance")}
        align="right"
        alignHeader="right"
        body={(line: BalanceSheetLine) => formatMoney(line.balance, currency)}
      />
    </DataTable>
  );
}
