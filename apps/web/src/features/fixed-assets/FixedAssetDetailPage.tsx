import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatAmount } from "../../shared/lib/money";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { JournalEntryLinkButton } from "../accounting/JournalEntryLinkButton";
import { CapitalizeDialog, DisposeDialog, EditInfoDialog, TransferDialog } from "./AssetActionDialogs";
import { AssetStatusTag } from "./AssetStatusTag";
import { SectionTabs } from "./SectionTabs";
import { fixedAssetErrorKey, useDeleteDraftAsset, useFixedAsset, type FixedAssetDetail, type ScheduleRow, type TransferRow } from "./use-fixed-assets";
import "./fixed-assets.css";

const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
type DialogName = "capitalize" | "transfer" | "dispose" | "info" | null;
type DetailTab = "overview" | "schedule" | "transfers";

// Percent of the depreciable amount already written off, from decimal strings (display only).
function progressPercent(a: FixedAssetDetail): number {
  const depreciable = Number(a.acquisitionCost) - Number(a.residualValue);
  if (!(depreciable > 0)) return 0;
  return Math.min(100, Math.round((Number(a.accumulatedDepreciation) / depreciable) * 100));
}

interface ScheduleView extends ScheduleRow {
  readonly posted: boolean;
  readonly runNumber: string | null;
  readonly isCatchUp: boolean;
}

// One asset: its numbers, the full depreciation schedule (posted months and the rest of the life), its movements, and
// every action that applies to its current status.
export function FixedAssetDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { data: asset, isPending, isError, refetch } = useFixedAsset(id);
  const remove = useDeleteDraftAsset();
  const [dialog, setDialog] = useState<DialogName>(null);
  const [tab, setTab] = useState<DetailTab>("overview");

  if (isPending) return <PageSkeleton />;
  if (isError || !asset) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>{t("actions.retry")}</button>
      </div>
    );
  }

  const money = (v: string): string => formatAmount(v, asset.currency);
  const date = (v: string | null): string => (v ? formatCalendarDate(v, i18n.language) : "—");
  const month = (y: number, m: number): string => `${t(`fixedAssets.months.${MONTH_KEYS[m - 1]}`)} ${y}`;
  const inService = asset.status === "ACTIVE" || asset.status === "FULLY_DEPRECIATED";
  const percent = progressPercent(asset);

  // Posted months come from the runs; the rest of the life is the projection from where the asset stands now.
  const postedMonths = new Set(asset.depreciationHistory.map((h) => `${h.periodYear}-${h.periodMonth}`));
  const schedule: ScheduleView[] = [
    ...asset.depreciationHistory.map((h) => ({
      year: h.periodYear,
      month: h.periodMonth,
      fromDate: h.fromDate,
      toDate: h.toDate,
      days: h.days,
      amount: h.amount,
      accumulated: h.accumulatedAfter,
      netBookValue: h.netBookValueAfter,
      posted: true,
      runNumber: h.runNumber,
      isCatchUp: h.isCatchUp,
    })),
    ...(asset.status === "DISPOSED"
      ? []
      : asset.projectedSchedule
          .filter((r) => !postedMonths.has(`${r.year}-${r.month}`) && (!asset.depreciatedThrough || r.toDate > asset.depreciatedThrough))
          .map((r) => ({ ...r, posted: false, runNumber: null, isCatchUp: false }))),
  ];

  const deleteDraft = (): void => {
    if (!window.confirm(t("fixedAssets.detail.deleteConfirm"))) return;
    remove.mutate(asset.id, { onSuccess: () => void navigate("/fixed-assets") });
  };

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">
            <span dir="ltr">{asset.number}</span> · {localizedName(asset, i18n.language)}
          </h1>
          <p className="erp-page__subtitle">
            <AssetStatusTag status={asset.status} /> {localizedName(asset.category, i18n.language)} · {t(`fixedAssets.source.${asset.sourceType}`)}
          </p>
        </div>
        <div className="erp-page__header-actions">
          {asset.status === "DRAFT" ? (
            <>
              <PermissionButton allowed={can("fixed_asset:create")} label={t("fixedAssets.detail.delete")} icon="pi pi-trash" severity="danger" text loading={remove.isPending} onClick={deleteDraft} />
              <PermissionButton allowed={can("fixed_asset:create")} label={t("fixedAssets.detail.editDraft")} icon="pi pi-pencil" outlined onClick={() => void navigate(`/fixed-assets/${asset.id}/edit`)} />
              <PermissionButton allowed={can("fixed_asset:capitalize")} label={t("fixedAssets.detail.capitalize")} icon="pi pi-check-circle" onClick={() => setDialog("capitalize")} />
            </>
          ) : null}
          {inService ? (
            <>
              <PermissionButton allowed={can("fixed_asset:update")} label={t("fixedAssets.detail.editInfo")} icon="pi pi-pencil" text onClick={() => setDialog("info")} />
              <PermissionButton allowed={can("fixed_asset:update")} label={t("fixedAssets.detail.transfer")} icon="pi pi-arrow-right-arrow-left" outlined onClick={() => setDialog("transfer")} />
              <PermissionButton allowed={can("fixed_asset:dispose")} label={t("fixedAssets.detail.dispose")} icon="pi pi-times-circle" severity="danger" outlined onClick={() => setDialog("dispose")} />
            </>
          ) : null}
          {asset.supplierInvoiceId ? <Button label={t("fixedAssets.detail.openInvoice")} icon="pi pi-file" text onClick={() => void navigate(`/purchasing/invoices/${asset.supplierInvoiceId}`)} /> : null}
          {asset.capitalizationJournalEntryId ? <JournalEntryLinkButton entryId={asset.capitalizationJournalEntryId} /> : null}
        </div>
      </div>

      {remove.isError ? <p className="erp-auth-card__error">{t(fixedAssetErrorKey(remove.error))}</p> : null}
      {asset.status === "DRAFT" ? <p className="fa-notice"><i className="pi pi-info-circle" /> {t("fixedAssets.detail.draftNotice")}</p> : null}
      {asset.status === "FULLY_DEPRECIATED" ? <p className="fa-notice fa-notice--success"><i className="pi pi-check-circle" /> {t("fixedAssets.detail.fullyNotice")}</p> : null}
      {asset.disposal ? (
        <p className="fa-notice fa-notice--danger">
          <i className="pi pi-times-circle" /> {t("fixedAssets.detail.disposedNotice", { date: date(asset.disposal.disposalDate), type: t(`fixedAssets.disposalTypes.${asset.disposal.disposalType}`), reason: asset.disposal.reason })}
        </p>
      ) : null}

      <div className="fa-kpis">
        <div className="fa-kpi">
          <span className="fa-kpi__label">{t("fixedAssets.fields.acquisitionCost")}</span>
          <span className="fa-kpi__value" dir="ltr">{money(asset.acquisitionCost)}<small>{asset.currency}</small></span>
        </div>
        <div className="fa-kpi">
          <span className="fa-kpi__label">{t("fixedAssets.fields.accumulatedDepreciation")}</span>
          <span className="fa-kpi__value" dir="ltr">{money(asset.accumulatedDepreciation)}<small>{asset.currency}</small></span>
          {asset.isDepreciable ? (
            <>
              <div className="fa-progress" aria-hidden="true"><span style={{ inlineSize: `${percent}%` }} /></div>
              <small className="fa-muted">{t("fixedAssets.detail.progress", { percent })}</small>
            </>
          ) : null}
        </div>
        <div className="fa-kpi">
          <span className="fa-kpi__label">{t("fixedAssets.fields.netBookValue")}</span>
          <span className="fa-kpi__value" dir="ltr">{money(asset.netBookValue)}<small>{asset.currency}</small></span>
        </div>
        <div className="fa-kpi">
          <span className="fa-kpi__label">{t("fixedAssets.fields.usefulLife")}</span>
          <span className="fa-kpi__value">{asset.usefulLifeMonths ? t("fixedAssets.fields.monthsCount", { count: asset.usefulLifeMonths }) : "—"}</span>
          {asset.lastDepreciationDay ? <small className="fa-muted">{t("fixedAssets.fields.lastDepreciationDay")}: {date(asset.lastDepreciationDay)}</small> : null}
        </div>
      </div>

      <SectionTabs
        label={t("fixedAssets.detail.tabs.overview")}
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: t("fixedAssets.detail.tabs.overview") },
          { id: "schedule", label: t("fixedAssets.detail.tabs.schedule") },
          { id: "transfers", label: t("fixedAssets.detail.tabs.transfers") },
        ]}
      />
      {tab === "overview" ? (
        <div role="tabpanel">
          <h3 className="erp-form__section-title">{t("fixedAssets.detail.ledgerFacts")}</h3>
          <dl className="mk-facts">
            <div><dt>{t("fixedAssets.fields.acquisitionDate")}</dt><dd>{date(asset.acquisitionDate)}</dd></div>
            <div><dt>{t("fixedAssets.fields.inServiceDate")}</dt><dd>{date(asset.inServiceDate)}</dd></div>
            <div><dt>{t("fixedAssets.fields.residualValue")}</dt><dd dir="ltr">{money(asset.residualValue)}</dd></div>
            <div><dt>{t("fixedAssets.fields.method")}</dt><dd>{asset.isDepreciable ? t("fixedAssets.fields.straightLine") : t("fixedAssets.categories.notDepreciable")}</dd></div>
            <div><dt>{t("fixedAssets.fields.depreciatedThrough")}</dt><dd>{date(asset.depreciatedThrough)}</dd></div>
            {asset.sourceAccount ? <div><dt>{t("fixedAssets.fields.sourceAccount")}</dt><dd><span className="coa-code" dir="ltr">{asset.sourceAccount.code}</span> {localizedName(asset.sourceAccount, i18n.language)}</dd></div> : null}
            {asset.sourceType === "OPENING" ? (
              <>
                <div><dt>{t("fixedAssets.fields.openingAsOfDate")}</dt><dd>{date(asset.openingAsOfDate)}</dd></div>
                <div><dt>{t("fixedAssets.fields.openingAccumulated")}</dt><dd dir="ltr">{money(asset.openingAccumulatedDepreciation)}</dd></div>
              </>
            ) : null}
          </dl>
          <h3 className="erp-form__section-title">{t("fixedAssets.detail.infoFacts")}</h3>
          <dl className="mk-facts">
            <div><dt>{t("fixedAssets.fields.location")}</dt><dd>{asset.location ?? "—"}</dd></div>
            <div><dt>{t("fixedAssets.fields.custodian")}</dt><dd>{asset.custodian ? localizedName(asset.custodian, i18n.language) : "—"}</dd></div>
            <div><dt>{t("fixedAssets.fields.costCenter")}</dt><dd>{asset.costCenter ? `${asset.costCenter.code} — ${localizedName(asset.costCenter, i18n.language)}` : "—"}</dd></div>
            <div><dt>{t("fixedAssets.fields.supplier")}</dt><dd>{asset.supplier?.name ?? "—"}</dd></div>
            <div><dt>{t("fixedAssets.fields.serialNumber")}</dt><dd dir="ltr">{asset.serialNumber ?? "—"}</dd></div>
            <div><dt>{t("fixedAssets.fields.barcode")}</dt><dd dir="ltr">{asset.barcode ?? "—"}</dd></div>
            <div><dt>{t("fixedAssets.fields.description")}</dt><dd>{asset.description ?? "—"}</dd></div>
          </dl>
          {asset.disposal ? (
            <div className="erp-page__header-actions">
              <span className="fa-muted">{t("fixedAssets.detail.disposalEntry")}</span>
              <JournalEntryLinkButton entryId={asset.disposal.journalEntryId} />
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "schedule" ? (
        <div role="tabpanel">
          {!asset.isDepreciable ? (
            <EmptyState icon="pi pi-minus-circle" title={t("fixedAssets.detail.noSchedule")} />
          ) : (
            <DataTable value={schedule} className="erp-table" size="small" stripedRows showGridlines rowClassName={(r: ScheduleView) => (r.posted ? "" : "fa-row-projected")} scrollable scrollHeight="32rem" emptyMessage={t("status.empty")}>
              <Column header={t("fixedAssets.detail.period")} body={(r: ScheduleView) => month(r.year, r.month)} />
              <Column header={t("fixedAssets.detail.from")} body={(r: ScheduleView) => <span dir="ltr">{r.fromDate}</span>} />
              <Column header={t("fixedAssets.detail.to")} body={(r: ScheduleView) => <span dir="ltr">{r.toDate}</span>} />
              <Column header={t("fixedAssets.detail.days")} align="right" body={(r: ScheduleView) => r.days} />
              <Column header={t("fixedAssets.detail.amount")} align="right" body={(r: ScheduleView) => <span dir="ltr">{money(r.amount)}</span>} />
              <Column header={t("fixedAssets.detail.accumulated")} align="right" body={(r: ScheduleView) => <span dir="ltr">{money(r.accumulated)}</span>} />
              <Column header={t("fixedAssets.fields.netBookValue")} align="right" body={(r: ScheduleView) => <span dir="ltr">{money(r.netBookValue)}</span>} />
              <Column
                header={t("fixedAssets.fields.status")}
                body={(r: ScheduleView) =>
                  r.posted ? (
                    <>
                      <Tag value={t("fixedAssets.detail.posted")} severity="success" />
                      {r.isCatchUp ? <Tag className="fa-catchup" value={t("fixedAssets.detail.catchUp")} severity="warning" /> : null}
                      {r.runNumber ? <span className="fa-muted fa-catchup" dir="ltr">{r.runNumber}</span> : null}
                    </>
                  ) : (
                    <Tag value={t("fixedAssets.detail.projected")} severity="secondary" />
                  )
                }
              />
            </DataTable>
          )}
        </div>
      ) : null}

      {tab === "transfers" ? (
        <div role="tabpanel">
          {asset.transfers.length === 0 ? (
            <EmptyState icon="pi pi-arrow-right-arrow-left" title={t("fixedAssets.detail.noTransfers")} />
          ) : (
            <DataTable value={[...asset.transfers]} className="erp-table" size="small" stripedRows showGridlines>
              <Column header={t("fixedAssets.detail.transferDate")} body={(r: TransferRow) => date(r.transferDate)} />
              <Column header={t("fixedAssets.fields.location")} body={(r: TransferRow) => t("fixedAssets.detail.fromTo", { from: r.fromLocation ?? "—", to: r.toLocation ?? "—" })} />
              <Column header={t("fixedAssets.fields.custodian")} body={(r: TransferRow) => t("fixedAssets.detail.fromTo", { from: r.fromCustodian ?? "—", to: r.toCustodian ?? "—" })} />
              <Column header={t("fixedAssets.fields.costCenter")} body={(r: TransferRow) => t("fixedAssets.detail.fromTo", { from: r.fromCostCenter ?? "—", to: r.toCostCenter ?? "—" })} />
              <Column header={t("fixedAssets.transfer.reason")} body={(r: TransferRow) => r.reason ?? "—"} />
            </DataTable>
          )}
        </div>
      ) : null}

      <div className="erp-form__actions">
        <Button type="button" label={t("documents.backToList")} text onClick={() => void navigate("/fixed-assets")} />
      </div>

      {dialog === "capitalize" ? <CapitalizeDialog asset={asset} visible onHide={() => setDialog(null)} /> : null}
      {dialog === "transfer" ? <TransferDialog asset={asset} visible onHide={() => setDialog(null)} /> : null}
      {dialog === "dispose" ? <DisposeDialog asset={asset} visible onHide={() => setDialog(null)} /> : null}
      {dialog === "info" ? <EditInfoDialog asset={asset} visible onHide={() => setDialog(null)} /> : null}
    </div>
  );
}
