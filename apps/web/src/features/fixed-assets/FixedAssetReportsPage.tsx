import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { formatCalendarDate, toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatAmount } from "../../shared/lib/money";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ExportButtons } from "../../shared/ui/ExportButtons";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { exportReport, type ExportFormat } from "../accounting/export-report";
import "./fixed-assets.css";
import { SectionTabs } from "./SectionTabs";
import { useMovementReport, useReconciliationReport, useRegisterReport, type MovementReport, type ReconciliationReport, type RegisterReport } from "./use-fixed-assets";

// ── Shared helpers ────────────────────────────────────────────────────────────

const TABS = ["register", "movement", "reconciliation"] as const;
type ReportTab = (typeof TABS)[number];

function parseTab(value: string | null): ReportTab {
  return value === "movement" || value === "reconciliation" ? value : "register";
}

// The first day of this year and today: the period the movement screen opens on.
function defaultPeriod(): { from: Date; to: Date } {
  const now = new Date();
  return { from: new Date(now.getFullYear(), 0, 1), to: now };
}

type RegisterRow = RegisterReport["rows"][number];
type RegisterCategoryRow = RegisterReport["byCategory"][number];
type MovementRow = MovementReport["rows"][number];
type MovementKey = keyof MovementReport["totals"];
type ReconciliationRow = ReconciliationReport["rows"][number];

// An amount cell: the decimal string is only ever formatted, never parsed into a number.
function amountCell(value: string, currency: string): React.JSX.Element {
  return (
    <span className="coa-amount" dir="ltr">
      {formatAmount(value, currency)}
    </span>
  );
}

function LoadError({ onRetry }: { readonly onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div>
      <p className="erp-page__error">{t("status.error")}</p>
      <button type="button" className="erp-button-link" onClick={onRetry}>
        {t("actions.retry")}
      </button>
    </div>
  );
}

// ── Register: every asset and what it stood at on one date ────────────────────

function RegisterTab(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [asOf, setAsOf] = useState<Date>(() => new Date());
  const asOfIso = toDateOnlyIsoString(asOf);
  const { data, isPending, isError, refetch } = useRegisterReport(asOfIso);
  const currency = data?.currency ?? "SAR";

  const handleExport = (format: ExportFormat): Promise<void> =>
    exportReport("/v1/fixed-assets/reports/register/export", { format, asOf: asOfIso, lang: i18n.language }, "fixed-asset-register", format);

  return (
    <>
      <div className="coa-toolbar">
        <div className="coa-levels">
          <label className="coa-levels__label" htmlFor="faReportRegisterAsOf">
            {t("fixedAssets.reports.asOf")}
          </label>
          <Calendar
            inputId="faReportRegisterAsOf"
            value={asOf}
            onChange={(e) => {
              if (e.value instanceof Date) setAsOf(e.value);
            }}
            dateFormat="yy-mm-dd"
          />
        </div>
        <ExportButtons onExport={handleExport} />
      </div>

      {isPending ? (
        <PageSkeleton />
      ) : isError || !data ? (
        <LoadError onRetry={() => void refetch()} />
      ) : data.rows.length === 0 ? (
        <EmptyState icon="pi pi-chart-pie" title={t("status.empty")} />
      ) : (
        <>
          <DataTable value={[...data.byCategory]} className="erp-table" stripedRows showGridlines size="small" header={t("fixedAssets.reports.byCategory")}>
            <Column header={t("fixedAssets.fields.category")} body={(r: RegisterCategoryRow) => localizedName({ name: r.categoryName, nameAr: r.categoryNameAr }, i18n.language)} />
            <Column header={t("fixedAssets.reports.count")} align="right" body={(r: RegisterCategoryRow) => r.count} />
            <Column
              header={`${t("fixedAssets.fields.acquisitionCost")} (${currency})`}
              align="right"
              body={(r: RegisterCategoryRow) => amountCell(r.cost, currency)}
            />
            <Column
              header={`${t("fixedAssets.fields.accumulatedDepreciation")} (${currency})`}
              align="right"
              body={(r: RegisterCategoryRow) => amountCell(r.accumulatedDepreciation, currency)}
            />
            <Column
              header={`${t("fixedAssets.fields.netBookValue")} (${currency})`}
              align="right"
              body={(r: RegisterCategoryRow) => <strong>{amountCell(r.netBookValue, currency)}</strong>}
            />
          </DataTable>

          <DataTable
            value={[...data.rows]}
            className="erp-table"
            stripedRows
            showGridlines
            size="small"
            selectionMode="single"
            onRowClick={(e) => void navigate(`/fixed-assets/${(e.data as RegisterRow).assetId}`)}
          >
            <Column
              header={t("fixedAssets.fields.number")}
              style={{ width: "9rem" }}
              body={(r: RegisterRow) => (
                <span className="coa-code" dir="ltr">
                  {r.number}
                </span>
              )}
              footer={<strong>{t("fixedAssets.reports.total")}</strong>}
            />
            <Column
              header={t("fixedAssets.fields.name")}
              body={(r: RegisterRow) => localizedName(r, i18n.language)}
              footer={
                <span>
                  {t("fixedAssets.reports.count")}: {data.totals.count}
                </span>
              }
            />
            <Column header={t("fixedAssets.fields.category")} body={(r: RegisterRow) => localizedName({ name: r.categoryName, nameAr: r.categoryNameAr }, i18n.language)} />
            <Column
              header={t("fixedAssets.fields.inServiceDate")}
              style={{ width: "8rem" }}
              body={(r: RegisterRow) => <span dir="ltr">{formatCalendarDate(r.inServiceDate, i18n.language)}</span>}
            />
            <Column header={`${t("fixedAssets.fields.acquisitionCost")} (${currency})`} align="right" body={(r: RegisterRow) => amountCell(r.cost, currency)} footer={amountCell(data.totals.cost, currency)} />
            <Column
              header={`${t("fixedAssets.fields.accumulatedDepreciation")} (${currency})`}
              align="right"
              body={(r: RegisterRow) => amountCell(r.accumulatedDepreciation, currency)}
              footer={amountCell(data.totals.accumulatedDepreciation, currency)}
            />
            <Column
              header={`${t("fixedAssets.fields.netBookValue")} (${currency})`}
              align="right"
              body={(r: RegisterRow) => <strong>{amountCell(r.netBookValue, currency)}</strong>}
              footer={<strong>{amountCell(data.totals.netBookValue, currency)}</strong>}
            />
          </DataTable>
        </>
      )}
    </>
  );
}

// ── Movement: cost and depreciation rolling from opening to closing ───────────

function MovementTab(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState(defaultPeriod);
  const from = toDateOnlyIsoString(period.from);
  const to = toDateOnlyIsoString(period.to);
  const { data, isPending, isError, refetch } = useMovementReport(from, to);
  const currency = data?.currency ?? "SAR";
  const validPeriod = from <= to;

  const handleExport = (format: ExportFormat): Promise<void> =>
    exportReport("/v1/fixed-assets/reports/movement/export", { format, from, to, lang: i18n.language }, "fixed-asset-movement", format);

  const total = (key: MovementKey): React.JSX.Element => amountCell(data ? data.totals[key] : "0", currency);

  return (
    <>
      <div className="coa-toolbar">
        <div className="coa-levels">
          <label className="coa-levels__label" htmlFor="faReportMovementFrom">
            {t("fixedAssets.reports.from")}
          </label>
          <Calendar
            inputId="faReportMovementFrom"
            value={period.from}
            onChange={(e) => {
              if (e.value instanceof Date) setPeriod((p) => ({ ...p, from: e.value as Date }));
            }}
            dateFormat="yy-mm-dd"
            maxDate={period.to}
          />
          <label className="coa-levels__label" htmlFor="faReportMovementTo">
            {t("fixedAssets.reports.to")}
          </label>
          <Calendar
            inputId="faReportMovementTo"
            value={period.to}
            onChange={(e) => {
              if (e.value instanceof Date) setPeriod((p) => ({ ...p, to: e.value as Date }));
            }}
            dateFormat="yy-mm-dd"
            minDate={period.from}
          />
        </div>
        <ExportButtons onExport={handleExport} />
      </div>

      {!validPeriod ? (
        <EmptyState icon="pi pi-chart-pie" title={t("status.empty")} />
      ) : isPending ? (
        <PageSkeleton />
      ) : isError || !data ? (
        <LoadError onRetry={() => void refetch()} />
      ) : data.rows.length === 0 ? (
        <EmptyState icon="pi pi-chart-pie" title={t("status.empty")} />
      ) : (
        <DataTable value={[...data.rows]} className="erp-table" stripedRows showGridlines size="small" scrollable tableStyle={{ minWidth: "78rem" }}>
          <Column header={t("fixedAssets.fields.category")} body={(r: MovementRow) => localizedName({ name: r.categoryName, nameAr: r.categoryNameAr }, i18n.language)} footer={<strong>{t("fixedAssets.reports.total")}</strong>} />
          <Column header={`${t("fixedAssets.reports.costSection")} · ${t("fixedAssets.reports.movement.costOpening")}`} align="right" body={(r: MovementRow) => amountCell(r.costOpening, currency)} footer={total("costOpening")} />
          <Column header={`${t("fixedAssets.reports.costSection")} · ${t("fixedAssets.reports.movement.costAdditions")}`} align="right" body={(r: MovementRow) => amountCell(r.costAdditions, currency)} footer={total("costAdditions")} />
          <Column header={`${t("fixedAssets.reports.costSection")} · ${t("fixedAssets.reports.movement.costDisposals")}`} align="right" body={(r: MovementRow) => amountCell(r.costDisposals, currency)} footer={total("costDisposals")} />
          <Column header={`${t("fixedAssets.reports.costSection")} · ${t("fixedAssets.reports.movement.costClosing")}`} align="right" body={(r: MovementRow) => amountCell(r.costClosing, currency)} footer={total("costClosing")} />
          <Column header={`${t("fixedAssets.reports.depreciationSection")} · ${t("fixedAssets.reports.movement.depreciationOpening")}`} align="right" body={(r: MovementRow) => amountCell(r.depreciationOpening, currency)} footer={total("depreciationOpening")} />
          <Column header={`${t("fixedAssets.reports.depreciationSection")} · ${t("fixedAssets.reports.movement.depreciationOnOpeningAssets")}`} align="right" body={(r: MovementRow) => amountCell(r.depreciationOnOpeningAssets, currency)} footer={total("depreciationOnOpeningAssets")} />
          <Column header={`${t("fixedAssets.reports.depreciationSection")} · ${t("fixedAssets.reports.movement.depreciationCharge")}`} align="right" body={(r: MovementRow) => amountCell(r.depreciationCharge, currency)} footer={total("depreciationCharge")} />
          <Column header={`${t("fixedAssets.reports.depreciationSection")} · ${t("fixedAssets.reports.movement.depreciationOnDisposals")}`} align="right" body={(r: MovementRow) => amountCell(r.depreciationOnDisposals, currency)} footer={total("depreciationOnDisposals")} />
          <Column header={`${t("fixedAssets.reports.depreciationSection")} · ${t("fixedAssets.reports.movement.depreciationClosing")}`} align="right" body={(r: MovementRow) => amountCell(r.depreciationClosing, currency)} footer={total("depreciationClosing")} />
          <Column header={t("fixedAssets.reports.movement.netBookValueClosing")} align="right" body={(r: MovementRow) => <strong>{amountCell(r.netBookValueClosing, currency)}</strong>} footer={<strong>{total("netBookValueClosing")}</strong>} />
        </DataTable>
      )}
    </>
  );
}

// ── Reconciliation: the register against the ledger accounts behind it ────────

function ReconciliationTab(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [asOf, setAsOf] = useState<Date>(() => new Date());
  const asOfIso = toDateOnlyIsoString(asOf);
  const { data, isPending, isError, refetch } = useReconciliationReport(asOfIso);
  const currency = data?.currency ?? "SAR";

  // Zero is judged on the decimal string the server sent; nothing is ever parsed into a float.
  const isZero = (value: string): boolean => /^-?0(\.0+)?$/.test(value);

  return (
    <>
      <div className="coa-toolbar">
        <div className="coa-levels">
          <label className="coa-levels__label" htmlFor="faReportReconciliationAsOf">
            {t("fixedAssets.reports.asOf")}
          </label>
          <Calendar
            inputId="faReportReconciliationAsOf"
            value={asOf}
            onChange={(e) => {
              if (e.value instanceof Date) setAsOf(e.value);
            }}
            dateFormat="yy-mm-dd"
          />
        </div>
      </div>

      {isPending ? (
        <PageSkeleton />
      ) : isError || !data ? (
        <LoadError onRetry={() => void refetch()} />
      ) : data.rows.length === 0 ? (
        <EmptyState icon="pi pi-chart-pie" title={t("status.empty")} />
      ) : (
        <>
          {data.isReconciled ? (
            <div className="fa-notice fa-notice--success">
              <i className="pi pi-check-circle" /> {t("fixedAssets.reports.reconciled")}
            </div>
          ) : (
            <div className="fa-notice fa-notice--warning">
              <i className="pi pi-exclamation-triangle" /> {t("fixedAssets.reports.notReconciled")}
            </div>
          )}

          <DataTable value={[...data.rows]} className="erp-table" stripedRows showGridlines size="small">
            <Column
              header={t("fixedAssets.reports.account")}
              body={(r: ReconciliationRow) => (
                <span className="erp-table__account">
                  <span className="coa-code" dir="ltr">
                    {r.accountCode}
                  </span>
                  <span>{localizedName({ name: r.accountName, nameAr: r.accountNameAr }, i18n.language)}</span>
                </span>
              )}
            />
            <Column header={t("fixedAssets.reports.roleLabel")} body={(r: ReconciliationRow) => t(`fixedAssets.reports.role.${r.role}`)} />
            <Column header={`${t("fixedAssets.reports.registerAmount")} (${currency})`} align="right" body={(r: ReconciliationRow) => amountCell(r.registerAmount, currency)} />
            <Column header={`${t("fixedAssets.reports.ledgerAmount")} (${currency})`} align="right" body={(r: ReconciliationRow) => amountCell(r.ledgerAmount, currency)} />
            <Column
              header={`${t("fixedAssets.reports.difference")} (${currency})`}
              align="right"
              body={(r: ReconciliationRow) => (isZero(r.difference) ? amountCell(r.difference, currency) : <strong>{amountCell(r.difference, currency)}</strong>)}
            />
          </DataTable>
        </>
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

// Three report views of the fixed-asset module: the register on a date, movement over a period, and the
// register reconciled with the ledger accounts it posts to. The open tab lives in the URL so a report can
// be linked to and reloaded.
export function FixedAssetReportsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const activeTab = parseTab(params.get("tab"));

  const setTab = (tab: ReportTab): void => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("fixedAssets.reports.title")}</h1>
          <p className="erp-page__subtitle">{t("fixedAssets.reports.subtitle")}</p>
        </div>
      </div>

      <SectionTabs
        label={t("fixedAssets.reports.title")}
        active={activeTab}
        onChange={setTab}
        tabs={TABS.map((id) => ({ id, label: t(`fixedAssets.reports.tabs.${id}`) }))}
      />
      <div role="tabpanel">
        {activeTab === "register" ? <RegisterTab /> : activeTab === "movement" ? <MovementTab /> : <ReconciliationTab />}
      </div>
    </div>
  );
}
