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
import { useGoodsReceipts, type GoodsReceiptSummary } from "./use-goods-receipts";

// The receipts posted so far, newest first. A receipt is entered on its own form and never edited afterwards.
export function GoodsReceiptsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useGoodsReceipts();
  const receipts = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("inventory.goodsReceipt.listTitle")}</h1>
          <p className="erp-page__subtitle">{t("inventory.goodsReceipt.listSubtitle")}</p>
        </div>
        <PermissionButton allowed={can("goods_receipt:create")} label={t("inventory.goodsReceipt.title")} icon="pi pi-plus" onClick={() => void navigate("/inventory/goods-receipts/new")} />
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
          <DataGrid emptyAction={{ allowed: can("goods_receipt:create"), label: t("inventory.goodsReceipt.title"), onClick: () => void navigate("/inventory/goods-receipts/new") }} value={receipts} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
            <Column header={t("purchasing.number")} style={{ width: "11rem" }} body={(r: GoodsReceiptSummary) => <button type="button" className="erp-button-link coa-code" onClick={() => void navigate(`/inventory/goods-receipts/${r.id}`)}>{r.number}</button>} />
            <Column header={t("inventory.goodsReceipt.documentDate")} style={{ width: "9rem" }} body={(r: GoodsReceiptSummary) => formatCalendarDate(r.documentDate, i18n.language)} />
            <Column header={t("inventory.stockLevels.warehouse")} body={(r: GoodsReceiptSummary) => localizedName({ name: r.warehouseName, nameAr: r.warehouseNameAr }, i18n.language)} />
            <Column header={t("purchasing.supplier")} body={(r: GoodsReceiptSummary) => (r.partyName ? localizedName({ name: r.partyName, nameAr: r.partyNameAr }, i18n.language) : "—")} />
            <Column header={t("documents.purchaseOrder")} style={{ width: "12rem" }} body={(r: GoodsReceiptSummary) => r.purchaseOrderNumber ?? "—"} />
            <Column header={t("inventory.stockCount.lineCount")} align="right" style={{ width: "6rem" }} body={(r: GoodsReceiptSummary) => r.lineCount} />
            <Column header={t("documents.totalValue")} align="right" style={{ width: "11rem" }} body={(r: GoodsReceiptSummary) => formatMoney(r.totalValue, currency)} />
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
