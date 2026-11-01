import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataGrid } from "../../shared/ui/DataGrid";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useGoodsReturns, type GoodsReturnSummary } from "./use-goods-returns";

// The returns made so far. A return is started from the purchase order it belongs to (the order knows
// what can still go back), so this page is read-only: posted documents are never edited.
export function GoodsReturnsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useGoodsReturns();
  const returns = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("purchasing.returns.title")}</h1>
          <p className="erp-page__subtitle">{t("purchasing.returns.subtitle")}</p>
        </div>
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
          <DataGrid
            value={returns}
            className="erp-table"
            stripedRows
            showGridlines
            size="small"
            emptyMessage={t("purchasing.returns.empty")}
            selectionMode="single"
            onRowClick={(e) => void navigate(`/purchasing/orders/${(e.data as GoodsReturnSummary).purchaseOrderId}`)}
          >
            <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(row: GoodsReturnSummary) => <span className="coa-code">{row.number}</span>} />
            <Column header={t("purchasing.returns.documentDate")} style={{ width: "9rem" }} body={(row: GoodsReturnSummary) => formatCalendarDate(row.documentDate, i18n.language)} />
            <Column header={t("purchasing.supplier")} field="supplierName" />
            <Column header={t("purchasing.returns.order")} style={{ width: "12rem" }} body={(row: GoodsReturnSummary) => <span className="coa-code">{row.purchaseOrderNumber}</span>} />
            <Column header={t("purchasing.returns.warehouse")} field="warehouseName" style={{ width: "10rem" }} />
            <Column header={t("purchasing.returns.reference")} body={(row: GoodsReturnSummary) => row.reference ?? ""} style={{ width: "10rem" }} />
            <Column header={t("purchasing.returns.value")} align="right" style={{ width: "12rem" }} body={(row: GoodsReturnSummary) => formatMoney(row.totalValue, row.currency)} />
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
