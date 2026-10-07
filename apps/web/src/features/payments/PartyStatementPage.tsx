import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { SelectButton } from "primereact/selectbutton";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { formatCalendarDate, toDateOnlyIsoString } from "../../shared/lib/format-date";
import { formatMoney } from "../../shared/lib/money";
import { ExportButtons } from "../../shared/ui/ExportButtons";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PartyPicker } from "../accounting/PartyPicker";
import { exportReport, type ExportFormat } from "../accounting/export-report";
import { usePartyStatement, type PartyStatementLine, type Side } from "./use-receivables-reports";

// Every invoice, credit note and payment of one customer or supplier with a running balance.
export function PartyStatementPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const [side, setSide] = useState<Side>("SALES");
  const [partyId, setPartyId] = useState("");
  const defaults = useMemo(() => {
    const now = new Date();
    return { from: new Date(now.getFullYear(), 0, 1), to: now };
  }, []);
  const [from, setFrom] = useState<Date>(defaults.from);
  const [to, setTo] = useState<Date>(defaults.to);
  const fromIso = toDateOnlyIsoString(from);
  const toIso = toDateOnlyIsoString(to);
  const { data, isFetching, isError, refetch } = usePartyStatement(partyId, side, fromIso, toIso);

  const handleExport = (format: ExportFormat) =>
    exportReport("/v1/reports/party-statement/export", { lang: i18n.language, partyId, side, from: fromIso, to: toIso }, side === "SALES" ? "customer-statement" : "supplier-statement", format);

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("partyStatement.title")}</h1>
          <p className="erp-page__subtitle">{t("partyStatement.subtitle")}</p>
        </div>
        {data ? (
          <div className="erp-page__header-actions">
            <ExportButtons onExport={handleExport} />
          </div>
        ) : null}
      </div>

      <div className="erp-form__row">
        <div className="erp-field">
          <label>{t("partyStatement.kind")}</label>
          <SelectButton
            value={side}
            onChange={(e) => {
              if (e.value) {
                setSide(e.value as Side);
                setPartyId("");
              }
            }}
            options={[
              { label: t("partyStatement.customer"), value: "SALES" },
              { label: t("partyStatement.supplier"), value: "SUPPLIER" },
            ]}
            allowEmpty={false}
          />
        </div>
        <div className="erp-field erp-field--grow">
          <label htmlFor="psParty">{t("partyStatement.party")}</label>
          <PartyPicker inputId="psParty" value={partyId || null} onChange={(party) => setPartyId(party?.id ?? "")} />
        </div>
        <div className="erp-field">
          <label htmlFor="psFrom">{t("accounting.incomeStatement.from")}</label>
          <Calendar inputId="psFrom" value={from} onChange={(e) => e.value && setFrom(e.value)} dateFormat="yy-mm-dd" />
        </div>
        <div className="erp-field">
          <label htmlFor="psTo">{t("accounting.incomeStatement.to")}</label>
          <Calendar inputId="psTo" value={to} onChange={(e) => e.value && setTo(e.value)} dateFormat="yy-mm-dd" />
        </div>
      </div>

      {!partyId ? (
        <p className="erp-page__empty">{t("partyStatement.choose")}</p>
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
              {t("partyStatement.opening")}: <strong>{formatMoney(data.openingBalance, currency)}</strong>
            </span>
          </div>
          <DataTable value={[...data.lines]} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("partyStatement.empty")}>
            <Column header={t("partyStatement.date")} style={{ width: "9rem" }} body={(l: PartyStatementLine) => formatCalendarDate(l.date, i18n.language)} />
            <Column header={t("partyStatement.type")} style={{ width: "10rem" }} body={(l: PartyStatementLine) => t(`partyStatement.kinds.${l.kind}`)} />
            <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(l: PartyStatementLine) => <span className="coa-code">{l.number}</span>} />
            <Column header={t("partyStatement.reference")} body={(l: PartyStatementLine) => l.reference ?? ""} />
            <Column header={t("partyStatement.charges")} align="right" alignHeader="right" body={(l: PartyStatementLine) => (Number(l.charge) === 0 ? "" : formatMoney(l.charge, currency))} />
            <Column header={t("partyStatement.settlements")} align="right" alignHeader="right" body={(l: PartyStatementLine) => (Number(l.settlement) === 0 ? "" : formatMoney(l.settlement, currency))} />
            <Column header={t("partyStatement.balance")} align="right" alignHeader="right" body={(l: PartyStatementLine) => <strong>{formatMoney(l.balance, currency)}</strong>} />
          </DataTable>
          <div className="erp-table-footer">
            <span>
              {t("partyStatement.charges")}: <strong>{formatMoney(data.totalCharges, currency)}</strong>
            </span>
            <span>
              {t("partyStatement.settlements")}: <strong>{formatMoney(data.totalSettlements, currency)}</strong>
            </span>
            <span>
              {t("partyStatement.closing")}: <strong>{formatMoney(data.closingBalance, currency)}</strong>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
