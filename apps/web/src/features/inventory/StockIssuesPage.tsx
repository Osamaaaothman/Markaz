import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { usePermissions } from "../../shared/auth/use-permissions";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { DataGrid } from "../../shared/ui/DataGrid";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useStockIssues, type StockIssueSummary } from "./use-stock-issues";

// The issues to projects posted so far, newest first. An issue is entered on its own form and never edited afterwards.
export function StockIssuesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useStockIssues();
  const issues = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("inventory.stockIssue.listTitle")}</h1>
          <p className="erp-page__subtitle">{t("inventory.stockIssue.listSubtitle")}</p>
        </div>
        <PermissionButton allowed={can("stock_issue:create")} label={t("inventory.stockIssue.title")} icon="pi pi-plus" onClick={() => void navigate("/inventory/stock-issues/new")} />
      </div>

      {isPending ? (
        <PageSkeleton />
      ) : isError ? (
        <div className="erp-page">
          <p className="erp-page__error">{t("status.error")}</p>
          <button type="button" className="erp-button-link" onClick={() => void refetch()}>
            {t("actions.retry")}
          </button>
        </div>
      ) : (
        <>
          <DataGrid emptyAction={{ allowed: can("stock_issue:create"), label: t("inventory.stockIssue.title"), onClick: () => void navigate("/inventory/stock-issues/new") }} value={issues} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
            <Column header={t("purchasing.number")} style={{ width: "11rem" }} body={(r: StockIssueSummary) => <button type="button" className="erp-button-link coa-code" onClick={() => void navigate(`/inventory/stock-issues/${r.id}`)}>{r.number}</button>} />
            <Column header={t("inventory.goodsReceipt.documentDate")} style={{ width: "9rem" }} body={(r: StockIssueSummary) => formatCalendarDate(r.documentDate, i18n.language)} />
            <Column header={t("inventory.stockLevels.warehouse")} body={(r: StockIssueSummary) => localizedName({ name: r.warehouseName, nameAr: r.warehouseNameAr }, i18n.language)} />
            <Column header={t("documents.costCenter")} body={(r: StockIssueSummary) => r.costCenterRef} />
            <Column header={t("inventory.stockCount.lineCount")} align="right" style={{ width: "6rem" }} body={(r: StockIssueSummary) => r.lineCount} />
            <Column header={t("documents.totalValue")} align="right" style={{ width: "11rem" }} body={(r: StockIssueSummary) => formatMoney(r.totalValue, currency)} />
          </DataGrid>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
