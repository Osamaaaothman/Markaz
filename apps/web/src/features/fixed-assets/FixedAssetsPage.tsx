import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Column } from "primereact/column";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Paginator } from "primereact/paginator";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatAmount } from "../../shared/lib/money";
import { useDebouncedValue } from "../../shared/lib/use-debounced-value";
import { DataGrid } from "../../shared/ui/DataGrid";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { AssetStatusTag } from "./AssetStatusTag";
import { useAssetCategories, useFixedAssets, type AssetStatus, type FixedAssetSummary } from "./use-fixed-assets";

const STATUSES: readonly AssetStatus[] = ["DRAFT", "ACTIVE", "FULLY_DEPRECIATED", "DISPOSED"];
const PAGE_SIZE = 25;

// The register: every asset with its cost, what has been written off and what is left, filterable by status and category.
export function FixedAssetsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AssetStatus | "">("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 300);
  const categories = useAssetCategories(true);
  const { data, isPending, isError, refetch } = useFixedAssets({
    page,
    pageSize: PAGE_SIZE,
    search: debounced,
    ...(status ? { status } : {}),
    ...(categoryId ? { categoryId } : {}),
  });
  const currency = data?.items[0]?.currency ?? "";
  const amount = (v: string): React.JSX.Element => <span className="coa-amount" dir="ltr">{formatAmount(v, currency || "SAR")}</span>;
  const filtered = search !== "" || status !== "" || categoryId !== "";

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("fixedAssets.list.title")}</h1>
          <p className="erp-page__subtitle">{t("fixedAssets.list.subtitle")}</p>
        </div>
        <div className="erp-row-actions">
          <PermissionButton allowed={can("fixed_asset:capitalize")} label={t("fixedAssets.list.openingAsset")} icon="pi pi-history" outlined onClick={() => void navigate("/fixed-assets/opening")} />
          <PermissionButton allowed={can("fixed_asset:create")} label={t("fixedAssets.list.newAsset")} icon="pi pi-plus" onClick={() => void navigate("/fixed-assets/new")} />
        </div>
      </div>

      {data ? (
        <dl className="mk-facts">
          <div>
            <dt>{t("fixedAssets.fields.acquisitionCost")}</dt>
            <dd dir="ltr"><strong>{formatAmount(data.totals.acquisitionCost, currency || "SAR")}</strong></dd>
          </div>
          <div>
            <dt>{t("fixedAssets.fields.accumulatedDepreciation")}</dt>
            <dd dir="ltr">{formatAmount(data.totals.accumulatedDepreciation, currency || "SAR")}</dd>
          </div>
          <div>
            <dt>{t("fixedAssets.fields.netBookValue")}</dt>
            <dd dir="ltr"><strong>{formatAmount(data.totals.netBookValue, currency || "SAR")}</strong> {currency}</dd>
          </div>
          <div>
            <dt>{t("fixedAssets.list.totalsLabel")}</dt>
            <dd>{t("fixedAssets.list.count", { count: data.total })}</dd>
          </div>
        </dl>
      ) : null}

      <div className="coa-toolbar">
        <div className="coa-search">
          <InputText value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={t("fixedAssets.list.search")} aria-label={t("fixedAssets.list.search")} />
        </div>
        <Dropdown
          value={status || null}
          options={STATUSES.map((s) => ({ label: t(`fixedAssets.status.${s}`), value: s }))}
          onChange={(e) => { setStatus((e.value as AssetStatus | null) ?? ""); setPage(1); }}
          placeholder={t("fixedAssets.list.allStatuses")}
          showClear
          aria-label={t("fixedAssets.fields.status")}
        />
        <Dropdown
          value={categoryId || null}
          options={(categories.data ?? []).map((c) => ({ label: localizedName(c, i18n.language), value: c.id }))}
          onChange={(e) => { setCategoryId((e.value as string | null) ?? ""); setPage(1); }}
          placeholder={t("fixedAssets.list.allCategories")}
          showClear
          filter
          aria-label={t("fixedAssets.fields.category")}
        />
      </div>

      {isPending ? (
        <PageSkeleton />
      ) : isError ? (
        <div>
          <p className="erp-page__error">{t("status.error")}</p>
          <button type="button" className="erp-button-link" onClick={() => void refetch()}>{t("actions.retry")}</button>
        </div>
      ) : data.items.length === 0 && !filtered ? (
        <EmptyState
          icon="pi pi-car"
          title={t("fixedAssets.list.emptyTitle")}
          hint={t("fixedAssets.list.emptyHint")}
          {...(can("fixed_asset:create") ? { action: { label: t("fixedAssets.list.newAsset"), onClick: () => void navigate("/fixed-assets/new") } } : {})}
        />
      ) : (
        <>
          <DataGrid
            searchable={false}
            value={[...data.items]}
            className="erp-table"
            stripedRows
            showGridlines
            size="small"
            emptyMessage={t("status.empty")}
            selectionMode="single"
            onRowClick={(e) => void navigate(`/fixed-assets/${(e.data as FixedAssetSummary).id}`)}
          >
            <Column header={t("fixedAssets.fields.number")} style={{ width: "9rem" }} body={(r: FixedAssetSummary) => <span className="coa-code" dir="ltr">{r.number}</span>} />
            <Column header={t("fixedAssets.fields.name")} body={(r: FixedAssetSummary) => localizedName(r, i18n.language)} />
            <Column header={t("fixedAssets.fields.category")} body={(r: FixedAssetSummary) => localizedName(r.category, i18n.language)} />
            <Column header={t("fixedAssets.fields.inServiceDate")} style={{ width: "8rem" }} body={(r: FixedAssetSummary) => <span dir="ltr">{formatCalendarDate(r.inServiceDate, i18n.language)}</span>} />
            <Column header={t("fixedAssets.fields.acquisitionCost")} align="right" body={(r: FixedAssetSummary) => amount(r.acquisitionCost)} />
            <Column header={t("fixedAssets.fields.accumulatedDepreciation")} align="right" body={(r: FixedAssetSummary) => amount(r.accumulatedDepreciation)} />
            <Column header={t("fixedAssets.fields.netBookValue")} align="right" body={(r: FixedAssetSummary) => <strong>{amount(r.netBookValue)}</strong>} />
            <Column header={t("fixedAssets.fields.custodian")} body={(r: FixedAssetSummary) => (r.custodian ? localizedName(r.custodian, i18n.language) : "—")} />
            <Column header={t("fixedAssets.fields.status")} style={{ width: "9rem" }} body={(r: FixedAssetSummary) => <AssetStatusTag status={r.status} />} />
          </DataGrid>
          {data.total > PAGE_SIZE ? (
            <Paginator first={(page - 1) * PAGE_SIZE} rows={PAGE_SIZE} totalRecords={data.total} onPageChange={(e) => setPage(e.page + 1)} />
          ) : null}
        </>
      )}
    </div>
  );
}
