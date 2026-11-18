import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dialog } from "primereact/dialog";
import { InputTextarea } from "primereact/inputtextarea";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatAmount } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { JournalEntryLinkButton } from "../accounting/JournalEntryLinkButton";
import { MONTH_KEYS } from "./DepreciationRunsPage";
import { fixedAssetErrorKey, useDepreciationRun, useReverseDepreciationRun, type DepreciationLine } from "./use-fixed-assets";
import "./fixed-assets.css";

// One posted (or reversed) month: every asset it depreciated, its entry, and the reversal for the latest run.
export function DepreciationRunDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { data: run, isPending, isError, refetch } = useDepreciationRun(id);
  const reverse = useReverseDepreciationRun(id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (isPending) return <PageSkeleton />;
  if (isError || !run) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>{t("actions.retry")}</button>
      </div>
    );
  }
  const money = (v: string): string => formatAmount(v, run.currency);
  const period = `${t(`fixedAssets.months.${MONTH_KEYS[run.periodMonth - 1]}`)} ${run.periodYear}`;

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title"><span dir="ltr">{run.number}</span> · {period}</h1>
          <p className="erp-page__subtitle">
            <Tag value={t(`fixedAssets.runs.status.${run.status}`)} severity={run.status === "POSTED" ? "success" : "secondary"} /> {formatCalendarDate(run.runDate, i18n.language)}
          </p>
        </div>
        <div className="erp-page__header-actions">
          {run.status === "POSTED" ? (
            <PermissionButton allowed={can("depreciation_run:reverse") && run.canReverse} label={t("fixedAssets.runs.reverse")} icon="pi pi-undo" severity="danger" outlined onClick={() => { reverse.reset(); setOpen(true); }} />
          ) : null}
          <JournalEntryLinkButton entryId={run.journalEntryId} />
          {run.reversalJournalEntryId ? <JournalEntryLinkButton entryId={run.reversalJournalEntryId} /> : null}
        </div>
      </div>

      {run.status === "REVERSED" ? (
        <p className="fa-notice fa-notice--warning"><i className="pi pi-undo" /> {t("fixedAssets.runs.reversed", { date: run.reversedAt ? run.reversedAt.slice(0, 10) : "", reason: run.reversalReason ?? "" })}</p>
      ) : !run.canReverse ? (
        <p className="fa-notice"><i className="pi pi-info-circle" /> {t("fixedAssets.runs.cannotReverse")}</p>
      ) : null}

      <div className="fa-kpis">
        <div className="fa-kpi">
          <span className="fa-kpi__label">{t("fixedAssets.runs.total")}</span>
          <span className="fa-kpi__value" dir="ltr">{money(run.totalAmount)}<small>{run.currency}</small></span>
        </div>
        <div className="fa-kpi">
          <span className="fa-kpi__label">{t("fixedAssets.runs.assets")}</span>
          <span className="fa-kpi__value">{run.assetCount}</span>
        </div>
      </div>

      <DataTable value={[...run.lines]} className="erp-table" size="small" stripedRows showGridlines selectionMode="single" onRowClick={(e) => void navigate(`/fixed-assets/${(e.data as DepreciationLine).assetId}`)}>
        <Column header={t("fixedAssets.fields.number")} body={(l: DepreciationLine) => <span className="coa-code" dir="ltr">{l.assetNumber}</span>} />
        <Column header={t("fixedAssets.fields.name")} body={(l: DepreciationLine) => localizedName({ name: l.assetName, nameAr: l.assetNameAr }, i18n.language)} />
        <Column header={t("fixedAssets.fields.category")} body={(l: DepreciationLine) => localizedName({ name: l.categoryName, nameAr: l.categoryNameAr }, i18n.language)} />
        <Column header={t("fixedAssets.detail.from")} body={(l: DepreciationLine) => (
          <span dir="ltr">{l.fromDate}{l.isCatchUp ? <Tag className="fa-catchup" value={t("fixedAssets.detail.catchUp")} severity="warning" /> : null}</span>
        )} />
        <Column header={t("fixedAssets.detail.to")} body={(l: DepreciationLine) => <span dir="ltr">{l.toDate}</span>} />
        <Column header={t("fixedAssets.detail.days")} align="right" body={(l: DepreciationLine) => l.days} />
        <Column header={t("fixedAssets.detail.amount")} align="right" body={(l: DepreciationLine) => <span dir="ltr">{money(l.amount)}</span>} />
        <Column header={t("fixedAssets.detail.accumulated")} align="right" body={(l: DepreciationLine) => <span dir="ltr">{money(l.accumulatedAfter)}</span>} />
        <Column header={t("fixedAssets.fields.netBookValue")} align="right" body={(l: DepreciationLine) => <span dir="ltr">{money(l.netBookValueAfter)}</span>} />
      </DataTable>

      <div className="erp-form__actions">
        <Button type="button" label={t("documents.backToList")} text onClick={() => void navigate("/fixed-assets/depreciation-runs")} />
      </div>

      <Dialog header={t("fixedAssets.runs.reverseTitle")} visible={open} onHide={() => setOpen(false)} className="erp-dialog" modal style={{ width: "min(30rem, 96vw)" }}>
        <div className="erp-form">
          <p className="erp-field__hint">{t("fixedAssets.runs.reverseHint")}</p>
          <div className="erp-field">
            <label htmlFor="revReason">{t("fixedAssets.runs.reverseReason")}</label>
            <InputTextarea id="revReason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoResize maxLength={500} />
          </div>
          {reverse.isError ? <p className="erp-auth-card__error">{t(fixedAssetErrorKey(reverse.error))}</p> : null}
          <div className="erp-form__actions">
            <Button type="button" label={t("actions.cancel")} text onClick={() => setOpen(false)} />
            <Button type="button" severity="danger" icon="pi pi-undo" label={t("fixedAssets.runs.reverse")} disabled={!reason.trim()} loading={reverse.isPending} onClick={() => reverse.mutate(reason.trim(), { onSuccess: () => setOpen(false) })} />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
