import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputNumber } from "primereact/inputnumber";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatAmount, formatMoney } from "../../shared/lib/money";
import { DataGrid } from "../../shared/ui/DataGrid";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import {
  fixedAssetErrorKey,
  useDepreciationPreview,
  useDepreciationRuns,
  usePostDepreciationRun,
  type DepreciationLine,
  type DepreciationRunSummary,
} from "./use-fixed-assets";
import "./fixed-assets.css";

export const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

// The month after the latest posted run, or the current month when nothing has run yet.
function nextPeriod(runs: readonly DepreciationRunSummary[]): { periodYear: number; periodMonth: number } {
  const latest = runs.find((r) => r.status === "POSTED");
  if (!latest) {
    const now = new Date();
    return { periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1 };
  }
  return latest.periodMonth === 12 ? { periodYear: latest.periodYear + 1, periodMonth: 1 } : { periodYear: latest.periodYear, periodMonth: latest.periodMonth + 1 };
}

// Monthly depreciation: the list of runs, and a dialog that previews a month's run line by line before posting it.
export function DepreciationRunsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { data, isPending, isError, refetch } = useDepreciationRuns();
  const post = usePostDepreciationRun();
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<{ periodYear: number; periodMonth: number }>({ periodYear: new Date().getFullYear(), periodMonth: new Date().getMonth() + 1 });
  const preview = useDepreciationPreview(open ? period : null);
  const periodLabel = (y: number, m: number): string => `${t(`fixedAssets.months.${MONTH_KEYS[m - 1]}`)} ${y}`;
  const suggested = data ? nextPeriod(data) : null;

  const openDialog = (): void => {
    if (suggested) setPeriod(suggested);
    post.reset();
    setOpen(true);
  };

  const submit = (): void => {
    if (!preview.data) return;
    if (!window.confirm(t("fixedAssets.runs.postConfirm", { amount: formatMoney(preview.data.totalAmount, preview.data.currency), period: periodLabel(period.periodYear, period.periodMonth) }))) return;
    post.mutate(period, { onSuccess: (run) => void navigate(`/fixed-assets/depreciation-runs/${run.id}`) });
  };

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("fixedAssets.runs.title")}</h1>
          <p className="erp-page__subtitle">{t("fixedAssets.runs.subtitle")}</p>
        </div>
        <PermissionButton allowed={can("depreciation_run:post")} label={t("fixedAssets.runs.run")} icon="pi pi-play" onClick={openDialog} />
      </div>

      {suggested && data && data.length > 0 ? <p className="fa-notice"><i className="pi pi-calendar" /> {t("fixedAssets.runs.nextHint", { period: periodLabel(suggested.periodYear, suggested.periodMonth) })}</p> : null}

      {isPending ? (
        <PageSkeleton />
      ) : isError ? (
        <div>
          <p className="erp-page__error">{t("status.error")}</p>
          <button type="button" className="erp-button-link" onClick={() => void refetch()}>{t("actions.retry")}</button>
        </div>
      ) : data.length === 0 ? (
        <EmptyState icon="pi pi-calendar-minus" title={t("fixedAssets.runs.emptyTitle")} hint={t("fixedAssets.runs.emptyHint")} {...(can("depreciation_run:post") ? { action: { label: t("fixedAssets.runs.run"), onClick: openDialog } } : {})} />
      ) : (
        <DataGrid searchable={false} value={[...data]} className="erp-table" stripedRows showGridlines size="small" selectionMode="single" onRowClick={(e) => void navigate(`/fixed-assets/depreciation-runs/${(e.data as DepreciationRunSummary).id}`)}>
          <Column header={t("fixedAssets.runs.number")} style={{ width: "11rem" }} body={(r: DepreciationRunSummary) => <span className="coa-code" dir="ltr">{r.number}</span>} />
          <Column header={t("fixedAssets.runs.period")} body={(r: DepreciationRunSummary) => periodLabel(r.periodYear, r.periodMonth)} />
          <Column header={t("fixedAssets.runs.runDate")} body={(r: DepreciationRunSummary) => formatCalendarDate(r.runDate, i18n.language)} />
          <Column header={t("fixedAssets.runs.assets")} align="right" body={(r: DepreciationRunSummary) => r.assetCount} />
          <Column header={t("fixedAssets.runs.total")} align="right" body={(r: DepreciationRunSummary) => <span className="coa-amount" dir="ltr">{formatMoney(r.totalAmount, r.currency)}</span>} />
          <Column header={t("fixedAssets.fields.status")} body={(r: DepreciationRunSummary) => <Tag value={t(`fixedAssets.runs.status.${r.status}`)} severity={r.status === "POSTED" ? "success" : "secondary"} />} />
        </DataGrid>
      )}

      <Dialog header={t("fixedAssets.runs.run")} visible={open} onHide={() => setOpen(false)} className="erp-dialog" modal style={{ width: "min(60rem, 96vw)" }}>
        <div className="erp-form">
          <div className="fa-period-picker">
            <div className="erp-field">
              <label htmlFor="runMonth">{t("fixedAssets.runs.month")}</label>
              <Dropdown inputId="runMonth" value={period.periodMonth} options={MONTH_KEYS.map((k, i) => ({ label: t(`fixedAssets.months.${k}`), value: i + 1 }))} onChange={(e) => { setPeriod((p) => ({ ...p, periodMonth: (e.value as number | null) ?? 1 })); post.reset(); }} />
            </div>
            <div className="erp-field">
              <label htmlFor="runYear">{t("fixedAssets.runs.year")}</label>
              <InputNumber inputId="runYear" value={period.periodYear} onValueChange={(e) => { setPeriod((p) => ({ ...p, periodYear: e.value ?? p.periodYear })); post.reset(); }} useGrouping={false} min={2000} max={2200} />
            </div>
          </div>

          {preview.isFetching && !preview.data ? (
            <PageSkeleton />
          ) : preview.isError ? (
            <p className="fa-notice fa-notice--warning"><i className="pi pi-exclamation-triangle" /> {t(fixedAssetErrorKey(preview.error))}</p>
          ) : preview.data ? (
            <>
              <h4 className="erp-form__section-title">
                {t("fixedAssets.runs.previewTitle", { period: periodLabel(period.periodYear, period.periodMonth) })} — <span dir="ltr">{formatMoney(preview.data.totalAmount, preview.data.currency)}</span>
              </h4>
              {preview.data.lines.some((l) => l.isCatchUp) ? <p className="fa-notice"><i className="pi pi-info-circle" /> {t("fixedAssets.runs.catchUpNote")}</p> : null}
              <DataTable value={[...preview.data.lines]} className="erp-table" size="small" stripedRows showGridlines scrollable scrollHeight="22rem" emptyMessage={t("fixedAssets.runs.previewEmpty")}>
                <Column header={t("fixedAssets.fields.number")} body={(l: DepreciationLine) => <span className="coa-code" dir="ltr">{l.assetNumber}</span>} />
                <Column header={t("fixedAssets.fields.name")} body={(l: DepreciationLine) => localizedName({ name: l.assetName, nameAr: l.assetNameAr }, i18n.language)} />
                <Column header={t("fixedAssets.detail.from")} body={(l: DepreciationLine) => (
                  <span dir="ltr">{l.fromDate}{l.isCatchUp ? <Tag className="fa-catchup" value={t("fixedAssets.detail.catchUp")} severity="warning" /> : null}</span>
                )} />
                <Column header={t("fixedAssets.detail.days")} align="right" body={(l: DepreciationLine) => l.days} />
                <Column header={t("fixedAssets.detail.amount")} align="right" body={(l: DepreciationLine) => <span dir="ltr">{formatAmount(l.amount, preview.data.currency)}</span>} />
                <Column header={t("fixedAssets.fields.netBookValue")} align="right" body={(l: DepreciationLine) => <span dir="ltr">{formatAmount(l.netBookValueAfter, preview.data.currency)}</span>} />
              </DataTable>
            </>
          ) : null}

          {post.isError ? <p className="erp-auth-card__error">{t(fixedAssetErrorKey(post.error))}</p> : null}
          <div className="erp-form__actions">
            <Button type="button" label={t("actions.cancel")} text onClick={() => setOpen(false)} />
            <Button type="button" icon="pi pi-check" label={t("fixedAssets.runs.post")} disabled={!preview.data || preview.data.lines.length === 0} loading={post.isPending} onClick={submit} />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
