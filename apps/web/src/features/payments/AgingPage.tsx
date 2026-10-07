import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { SelectButton } from "primereact/selectbutton";
import { Tag } from "primereact/tag";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { ExportButtons } from "../../shared/ui/ExportButtons";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { exportReport, type ExportFormat } from "../accounting/export-report";
import { useAging, type AgingPartyRow, type Side } from "./use-receivables-reports";

const BUCKETS = ["current", "days1to30", "days31to60", "days61to90", "over90", "onAccount", "total"] as const;

// Open invoices by how overdue they are, for customers (receivables) or suppliers (payables), as of a
// date. The footer shows the control account's own balance and the difference: it must be zero.
export function AgingPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const [side, setSide] = useState<Side>("SALES");
  const [asOf, setAsOf] = useState<Date>(new Date());
  const asOfIso = toDateOnlyIsoString(asOf);
  const { data, isPending, isError, refetch } = useAging(side, asOfIso);

  const handleExport = (format: ExportFormat) =>
    exportReport("/v1/reports/aging/export", { lang: i18n.language, side, asOf: asOfIso }, side === "SALES" ? "receivables-ageing" : "payables-ageing", format);

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("aging.title")}</h1>
          <p className="erp-page__subtitle">{t("aging.subtitle")}</p>
        </div>
        <div className="erp-page__header-actions">
          <ExportButtons onExport={handleExport} />
        </div>
      </div>

      <div className="coa-toolbar">
        <SelectButton
          value={side}
          onChange={(e) => {
            if (e.value) setSide(e.value as Side);
          }}
          options={[
            { label: t("aging.receivables"), value: "SALES" },
            { label: t("aging.payables"), value: "SUPPLIER" },
          ]}
          allowEmpty={false}
        />
        <div className="coa-levels">
          <label className="coa-levels__label" htmlFor="agingAsOf">
            {t("aging.asOf")}
          </label>
          <Calendar inputId="agingAsOf" value={asOf} onChange={(e) => e.value && setAsOf(e.value)} dateFormat="yy-mm-dd" />
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
          <DataTable value={[...data.parties]} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("aging.empty")}>
            <Column header={t("aging.party")} body={(r: AgingPartyRow) => localizedName({ name: r.partyName, nameAr: r.partyNameAr }, i18n.language)} />
            {BUCKETS.map((b) => (
              <Column
                key={b}
                header={t(`aging.${b}`)}
                align="right"
                alignHeader="right"
                body={(r: AgingPartyRow) => (b === "total" ? <strong>{formatMoney(r[b], currency)}</strong> : formatMoney(r[b], currency))}
              />
            ))}
          </DataTable>
          <div className="erp-table-footer">
            <span>
              {t("aging.total")}: <strong>{formatMoney(data.totals.total, currency)}</strong>
            </span>
            {data.ledgerBalance === null ? (
              <Tag value={t("aging.notMapped")} severity="warning" />
            ) : (
              <>
                <span>
                  {t("aging.ledgerBalance")}: <strong>{formatMoney(data.ledgerBalance, currency)}</strong>
                </span>
                <Tag
                  value={Number(data.difference) === 0 ? t("aging.ties") : `${t("aging.difference")}: ${formatMoney(data.difference ?? "0", currency)}`}
                  severity={Number(data.difference) === 0 ? "success" : "danger"}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
