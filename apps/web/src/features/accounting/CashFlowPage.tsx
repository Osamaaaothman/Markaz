import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "primereact/calendar";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Message } from "primereact/message";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { formatMoney } from "../../shared/lib/money";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useFiscalPeriods } from "./use-fiscal-periods";
import { useCashFlow, type CashFlowLine, type CashFlowSection } from "./use-cash-flow";

export function CashFlowPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data: currentUser } = useCurrentUser();
  const { data: fiscalPeriods } = useFiscalPeriods();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const isAr = i18n.language === "ar";

  const defaultRange = useMemo(() => {
    if (!fiscalPeriods || fiscalPeriods.length === 0) return null;
    const starts = fiscalPeriods.map((p) => p.startDate).sort();
    const ends = fiscalPeriods.map((p) => p.endDate).sort();
    return { from: starts[0]!.slice(0, 10), to: ends[ends.length - 1]!.slice(0, 10) };
  }, [fiscalPeriods]);

  const [range, setRange] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null });
  const from = range.from ? toDateOnlyIsoString(range.from) : (defaultRange?.from ?? "");
  const to = range.to ? toDateOnlyIsoString(range.to) : (defaultRange?.to ?? "");

  const { data, isPending, isError, refetch } = useCashFlow(from, to);

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("accounting.cashFlow.title")}</h1>
          <p className="erp-page__subtitle">{t("accounting.cashFlow.subtitle")}</p>
        </div>
      </div>

      <div className="erp-form__row">
        <div className="erp-field">
          <label htmlFor="cashFlowFrom">{t("accounting.incomeStatement.from")}</label>
          <Calendar
            inputId="cashFlowFrom"
            value={range.from ?? (defaultRange ? new Date(defaultRange.from) : null)}
            onChange={(e) => setRange((prev) => ({ ...prev, from: e.value ?? null }))}
            dateFormat="yy-mm-dd"
          />
        </div>
        <div className="erp-field">
          <label htmlFor="cashFlowTo">{t("accounting.incomeStatement.to")}</label>
          <Calendar
            inputId="cashFlowTo"
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
      ) : (
        <>
          {!data.isBalanced && (
            <Message
              severity="warn"
              text={t("accounting.cashFlow.unbalancedWarning")}
              className="mb-3"
            />
          )}

          <CashFlowSectionTable
            title={t("accounting.cashFlow.operating")}
            section={data.operating}
            totalLabel={t("accounting.cashFlow.netOperating")}
            currency={currency}
            isAr={isAr}
          />

          <CashFlowSectionTable
            title={t("accounting.cashFlow.investing")}
            section={data.investing}
            totalLabel={t("accounting.cashFlow.netInvesting")}
            currency={currency}
            isAr={isAr}
          />

          <CashFlowSectionTable
            title={t("accounting.cashFlow.financing")}
            section={data.financing}
            totalLabel={t("accounting.cashFlow.netFinancing")}
            currency={currency}
            isAr={isAr}
          />

          <div className="erp-statement-section">
            <div className="erp-table-footer">
              <span>
                {t("accounting.cashFlow.netChange")}: <strong>{formatMoney(data.netChange, currency)}</strong>
              </span>
            </div>
            <div className="erp-table-footer">
              <span>
                {t("accounting.cashFlow.beginningCash")}: <strong>{formatMoney(data.beginningCash, currency)}</strong>
              </span>
            </div>
            <div className="erp-table-footer erp-table-footer--center">
              <span>
                {t("accounting.cashFlow.endingCash")}: <strong>{formatMoney(data.endingCash, currency)}</strong>
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CashFlowSectionTable({
  title,
  section,
  totalLabel,
  currency,
  isAr,
}: {
  readonly title: string;
  readonly section: CashFlowSection;
  readonly totalLabel: string;
  readonly currency: string;
  readonly isAr: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="erp-statement-section">
      <h2 className="erp-form__section-title">{title}</h2>
      <DataTable
        value={[...section.lines]}
        className="erp-table"
        stripedRows
        showGridlines
        size="small"
        emptyMessage={t("status.empty")}
      >
        <Column
          field="label"
          header={t("accounting.trialBalance.account")}
          body={(line: CashFlowLine) => (isAr ? line.labelAr : line.label)}
        />
        <Column
          field="amount"
          header={t("accounting.balanceSheet.balance")}
          align="right"
          alignHeader="right"
          body={(line: CashFlowLine) => formatMoney(line.amount, currency)}
        />
      </DataTable>
      <div className="erp-table-footer">
        <span>
          {totalLabel}: <strong>{formatMoney(section.total, currency)}</strong>
        </span>
      </div>
    </section>
  );
}
