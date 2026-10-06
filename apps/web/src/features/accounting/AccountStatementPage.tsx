import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dropdown } from "primereact/dropdown";
import { Message } from "primereact/message";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { ExportButtons } from "../../shared/ui/ExportButtons";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { exportReport, type ExportFormat } from "./export-report";
import { useChartOfAccounts } from "./use-chart-of-accounts";
import { useFiscalPeriods } from "./use-fiscal-periods";
import { useLedger, type LedgerStatementLine } from "./use-ledger";

export function AccountStatementPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data: currentUser } = useCurrentUser();
  const { data: accounts } = useChartOfAccounts();
  const { data: fiscalPeriods } = useFiscalPeriods();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";

  const [accountId, setAccountId] = useState("");
  const [range, setRange] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null });

  // Same default as the income statement: the whole fiscal calendar, adjustable.
  const defaultRange = useMemo(() => {
    if (!fiscalPeriods || fiscalPeriods.length === 0) return null;
    const starts = fiscalPeriods.map((p) => p.startDate).sort();
    const ends = fiscalPeriods.map((p) => p.endDate).sort();
    return { from: starts[0]!.slice(0, 10), to: ends[ends.length - 1]!.slice(0, 10) };
  }, [fiscalPeriods]);

  const from = range.from ? toDateOnlyIsoString(range.from) : (defaultRange?.from ?? "");
  const to = range.to ? toDateOnlyIsoString(range.to) : (defaultRange?.to ?? "");

  const postableAccounts = (accounts ?? []).filter((a) => a.isPostable);
  const { data, isFetching, isError, refetch } = useLedger(accountId, from, to);

  const handleExport = (format: ExportFormat) =>
    exportReport("/v1/ledger/export", { lang: i18n.language, accountId, from, to }, `ledger-${data?.accountCode ?? "account"}`, format);

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("accounting.accountStatement.title")}</h1>
          <p className="erp-page__subtitle">{t("accounting.accountStatement.subtitle")}</p>
        </div>
        {data ? (
          <div className="erp-page__header-actions">
            <ExportButtons onExport={handleExport} />
          </div>
        ) : null}
      </div>

      <div className="erp-form__row">
        <div className="erp-field erp-field--grow">
          <label htmlFor="statementAccount">{t("accounting.accountStatement.account")}</label>
          <Dropdown
            inputId="statementAccount"
            value={accountId || null}
            onChange={(e) => setAccountId((e.value as string | null) ?? "")}
            options={postableAccounts.map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id }))}
            placeholder={t("accounting.accountStatement.pickAccount")}
            filter
          />
        </div>
        <div className="erp-field">
          <label htmlFor="statementFrom">{t("accounting.incomeStatement.from")}</label>
          <Calendar
            inputId="statementFrom"
            value={range.from ?? (defaultRange ? new Date(defaultRange.from) : null)}
            onChange={(e) => setRange((prev) => ({ ...prev, from: e.value ?? null }))}
            dateFormat="yy-mm-dd"
          />
        </div>
        <div className="erp-field">
          <label htmlFor="statementTo">{t("accounting.incomeStatement.to")}</label>
          <Calendar
            inputId="statementTo"
            value={range.to ?? (defaultRange ? new Date(defaultRange.to) : null)}
            onChange={(e) => setRange((prev) => ({ ...prev, to: e.value ?? null }))}
            dateFormat="yy-mm-dd"
          />
        </div>
      </div>

      {!accountId ? (
        <p className="erp-page__empty">{t("accounting.accountStatement.choose")}</p>
      ) : isFetching && !data ? (
        <PageSkeleton />
      ) : isError || !data ? (
        <div>
          <p className="erp-page__error">{t("status.error")}</p>
          <button type="button" className="erp-button-link" onClick={() => void refetch()}>
            {t("actions.retry")}
          </button>
        </div>
      ) : (
        <>
          <div className="erp-table-footer">
            <span>
              {t("accounting.accountStatement.opening")}: <strong>{formatMoney(data.openingBalance, currency)}</strong>
            </span>
          </div>
          {data.truncated ? <Message severity="warn" text={t("accounting.accountStatement.truncated")} /> : null}
          <DataTable
            value={[...data.lines]}
            className="erp-table"
            stripedRows
            showGridlines
            size="small"
            emptyMessage={t("accounting.accountStatement.empty")}
          >
            <Column field="entryDate" header={t("accounting.accountStatement.date")} />
            <Column field="entryNumber" header={t("accounting.accountStatement.entry")} />
            <Column field="description" header={t("accounting.accountStatement.description")} />
            <Column
              field="debit"
              header={t("accounting.trialBalance.debit")}
              align="right"
              alignHeader="right"
              body={(line: LedgerStatementLine) => formatMoney(line.debit, currency)}
            />
            <Column
              field="credit"
              header={t("accounting.trialBalance.credit")}
              align="right"
              alignHeader="right"
              body={(line: LedgerStatementLine) => formatMoney(line.credit, currency)}
            />
            <Column
              field="balance"
              header={t("accounting.balanceSheet.balance")}
              align="right"
              alignHeader="right"
              body={(line: LedgerStatementLine) => formatMoney(line.balance, currency)}
            />
          </DataTable>
          <div className="erp-table-footer">
            <span>
              {t("accounting.trialBalance.totalDebit")}: <strong>{formatMoney(data.totalDebit, currency)}</strong>
            </span>
            <span>
              {t("accounting.trialBalance.totalCredit")}: <strong>{formatMoney(data.totalCredit, currency)}</strong>
            </span>
            <span>
              {t("accounting.accountStatement.closing")}: <strong>{formatMoney(data.closingBalance, currency)}</strong>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
