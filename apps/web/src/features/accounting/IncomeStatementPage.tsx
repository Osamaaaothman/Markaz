import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "primereact/calendar";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { formatMoney } from "../../shared/lib/money";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { ExportButtons } from "../../shared/ui/ExportButtons";
import { exportReport, type ExportFormat } from "./export-report";
import { useFiscalPeriods } from "./use-fiscal-periods";
import { useAccountLabel } from "./use-account-label";
import { useIncomeStatement, type IncomeStatementLine } from "./use-income-statement";

export function IncomeStatementPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data: currentUser } = useCurrentUser();
  const { data: fiscalPeriods } = useFiscalPeriods();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";

  // Defaults to the current (open) fiscal year's full span — the earliest open
  // period's start through the latest open period's end — adjustable from there.
  const defaultRange = useMemo(() => {
    if (!fiscalPeriods || fiscalPeriods.length === 0) {
      return null;
    }
    const starts = fiscalPeriods.map((p) => p.startDate).sort();
    const ends = fiscalPeriods.map((p) => p.endDate).sort();
    return { from: starts[0]!.slice(0, 10), to: ends[ends.length - 1]!.slice(0, 10) };
  }, [fiscalPeriods]);

  const [range, setRange] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null });

  const from = range.from ? toDateOnlyIsoString(range.from) : (defaultRange?.from ?? "");
  const to = range.to ? toDateOnlyIsoString(range.to) : (defaultRange?.to ?? "");

  const { data, isPending, isError, refetch } = useIncomeStatement(from, to);

  const handleExport = (format: ExportFormat) =>
    exportReport("/v1/income-statement/export", { lang: i18n.language, from, to }, "income-statement", format);

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("accounting.incomeStatement.title")}</h1>
          <p className="erp-page__subtitle">{t("accounting.incomeStatement.subtitle")}</p>
        </div>
        {from && to ? (
          <div className="erp-page__header-actions">
            <ExportButtons onExport={handleExport} />
          </div>
        ) : null}
      </div>

      <div className="erp-form__row">
        <div className="erp-field">
          <label htmlFor="incomeStatementFrom">{t("accounting.incomeStatement.from")}</label>
          <Calendar
            inputId="incomeStatementFrom"
            value={range.from ?? (defaultRange ? new Date(defaultRange.from) : null)}
            onChange={(e) => setRange((prev) => ({ ...prev, from: e.value ?? null }))}
            dateFormat="yy-mm-dd"
          />
        </div>
        <div className="erp-field">
          <label htmlFor="incomeStatementTo">{t("accounting.incomeStatement.to")}</label>
          <Calendar
            inputId="incomeStatementTo"
            value={range.to ?? (defaultRange ? new Date(defaultRange.to) : null)}
            onChange={(e) => setRange((prev) => ({ ...prev, to: e.value ?? null }))}
            dateFormat="yy-mm-dd"
          />
        </div>
      </div>

      {isPending ? (
        <PageSkeleton />
      ) : isError || !data ? (
        <div className="erp-page">
          <p className="erp-page__error">{t("status.error")}</p>
          <button type="button" className="erp-button-link" onClick={() => void refetch()}>
            {t("actions.retry")}
          </button>
        </div>
      ) : data.revenue.lines.length === 0 && data.expense.lines.length === 0 ? (
        <p className="erp-page__empty">{t("accounting.incomeStatement.empty")}</p>
      ) : (
        <>
          <section className="erp-statement-section">
            <h2 className="erp-form__section-title">{t("accounting.incomeStatement.revenue")}</h2>
            <IncomeStatementTable lines={data.revenue.lines} currency={currency} />
            <div className="erp-table-footer">
              <span>
                {t("accounting.incomeStatement.totalRevenue")}: <strong>{formatMoney(data.revenue.total, currency)}</strong>
              </span>
            </div>
          </section>

          <section className="erp-statement-section">
            <h2 className="erp-form__section-title">{t("accounting.incomeStatement.expense")}</h2>
            <IncomeStatementTable lines={data.expense.lines} currency={currency} />
            <div className="erp-table-footer">
              <span>
                {t("accounting.incomeStatement.totalExpense")}: <strong>{formatMoney(data.expense.total, currency)}</strong>
              </span>
            </div>
          </section>

          <div className="erp-table-footer erp-table-footer--center">
            <span>
              {t(data.netIncome.startsWith("-") ? "accounting.incomeStatement.netLoss" : "accounting.incomeStatement.netIncome")}:{" "}
              <strong>{formatMoney(data.netIncome, currency)}</strong>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function IncomeStatementTable({
  lines,
  currency,
}: {
  readonly lines: readonly IncomeStatementLine[];
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
        body={(line: IncomeStatementLine) => (
          <span className="erp-table__account">
            <span className="erp-table__account-code">{line.accountCode}</span>
            <span className="erp-table__account-name">{accountLabel(line.accountId, line.accountName)}</span>
          </span>
        )}
      />
      <Column
        field="amount"
        header={t("accounting.balanceSheet.balance")}
        align="right"
        alignHeader="right"
        body={(line: IncomeStatementLine) => formatMoney(line.amount, currency)}
      />
    </DataTable>
  );
}
