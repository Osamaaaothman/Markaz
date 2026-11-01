import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { ColumnGroup } from "primereact/columngroup";
import { DataTable } from "primereact/datatable";
import { Row } from "primereact/row";
import { Tag } from "primereact/tag";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { formatMoney } from "../../shared/lib/money";
import { ExportButtons } from "../../shared/ui/ExportButtons";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { exportReport, type ExportFormat } from "./export-report";
import { useAccountLabel } from "./use-account-label";
import { useTrialBalance, type TrialBalanceLine } from "./use-trial-balance";

// The first day of this year and today: the period the screen opens on.
function defaultPeriod(): { from: Date; to: Date } {
  const now = new Date();
  return { from: new Date(now.getFullYear(), 0, 1), to: now };
}

// A trial balance for a period: what each account stood at when it began (opening), what was posted in it (movement,
// debit and credit) and where it stands at the end (closing). Opening and closing are net balances on one side.
export function TrialBalancePage(): React.JSX.Element {
  const { t } = useTranslation();
  const i18n = useTranslation().i18n;
  const accountLabel = useAccountLabel();
  const { data: currentUser } = useCurrentUser();
  const [period, setPeriod] = useState(defaultPeriod);
  const from = toDateOnlyIsoString(period.from);
  const to = toDateOnlyIsoString(period.to);
  const { data, isPending, isError, refetch } = useTrialBalance(from, to);
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";

  const handleExport = (format: ExportFormat) => exportReport("/v1/trial-balance/export", { lang: i18n.language, from, to }, "trial-balance", format);
  const money = (value: string): string => formatMoney(value, currency);
  const cell = (value: string): React.ReactNode => (Number(value) === 0 ? <span className="coa-amount coa-amount--zero">—</span> : <span className="coa-amount">{money(value)}</span>);

  const headerGroup = (
    <ColumnGroup>
      <Row>
        <Column header={t("accounting.trialBalance.account")} rowSpan={2} />
        <Column header={t("accounting.trialBalance.opening")} colSpan={2} alignHeader="center" />
        <Column header={t("accounting.trialBalance.movement")} colSpan={2} alignHeader="center" />
        <Column header={t("accounting.trialBalance.closing")} colSpan={2} alignHeader="center" />
      </Row>
      <Row>
        {["a", "b", "c"].flatMap((group) => [
          <Column key={`${group}-d`} header={t("accounting.trialBalance.debit")} alignHeader="right" />,
          <Column key={`${group}-c`} header={t("accounting.trialBalance.credit")} alignHeader="right" />,
        ])}
      </Row>
    </ColumnGroup>
  );

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("accounting.trialBalance.title")}</h1>
          <p className="erp-page__subtitle">{t("accounting.trialBalance.periodSubtitle")}</p>
        </div>
        <div className="erp-page__header-actions">
          {data ? (
            <Tag value={data.isBalanced ? t("accounting.trialBalance.balanced") : t("accounting.trialBalance.outOfBalance")} severity={data.isBalanced ? "success" : "danger"} />
          ) : null}
          <ExportButtons onExport={handleExport} />
        </div>
      </div>

      <div className="coa-toolbar">
        <div className="coa-levels">
          <label className="coa-levels__label" htmlFor="tbFrom">
            {t("accounting.trialBalance.from")}
          </label>
          <Calendar inputId="tbFrom" value={period.from} onChange={(e) => e.value && setPeriod((p) => ({ ...p, from: e.value as Date }))} dateFormat="yy-mm-dd" maxDate={period.to} />
          <label className="coa-levels__label" htmlFor="tbTo">
            {t("accounting.trialBalance.to")}
          </label>
          <Calendar inputId="tbTo" value={period.to} onChange={(e) => e.value && setPeriod((p) => ({ ...p, to: e.value as Date }))} dateFormat="yy-mm-dd" minDate={period.from} />
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
      ) : data.lines.length === 0 ? (
        <p className="erp-page__empty">{t("accounting.trialBalance.empty")}</p>
      ) : (
        <>
          <DataTable value={[...data.lines]} className="erp-table erp-table--tb" stripedRows showGridlines size="small" headerColumnGroup={headerGroup}>
            <Column
              body={(line: TrialBalanceLine) => (
                <span className="erp-table__account">
                  <span className="erp-table__account-code">{line.accountCode}</span>
                  <span className="erp-table__account-name">{accountLabel(line.accountId, line.accountName)}</span>
                </span>
              )}
            />
            <Column align="right" body={(line: TrialBalanceLine) => cell(line.openingDebit)} />
            <Column align="right" body={(line: TrialBalanceLine) => cell(line.openingCredit)} />
            <Column align="right" body={(line: TrialBalanceLine) => cell(line.movementDebit)} />
            <Column align="right" body={(line: TrialBalanceLine) => cell(line.movementCredit)} />
            <Column align="right" body={(line: TrialBalanceLine) => cell(line.closingDebit)} />
            <Column align="right" body={(line: TrialBalanceLine) => cell(line.closingCredit)} />
          </DataTable>

          <div className="erp-table-footer erp-table-footer--tb">
            {(
              [
                ["opening", data.totals.openingDebit, data.totals.openingCredit],
                ["movement", data.totals.movementDebit, data.totals.movementCredit],
                ["closing", data.totals.closingDebit, data.totals.closingCredit],
              ] as const
            ).map(([group, debit, credit]) => (
              <div key={group} className="erp-table-footer__group">
                <span className="erp-table-footer__title">{t(`accounting.trialBalance.${group}`)}</span>
                <span>
                  {t("accounting.trialBalance.debit")}: <strong>{money(debit)}</strong>
                </span>
                <span>
                  {t("accounting.trialBalance.credit")}: <strong>{money(credit)}</strong>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
