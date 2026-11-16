import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataGrid } from "../../shared/ui/DataGrid";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { CreatedDialog, type CreatedInfo } from "../../shared/ui/CreatedDialog";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { ReceiveDialog } from "./ReceiveDialog";
import { OrderStatusTag } from "./StatusTags";
import { useReceivableOrder, useReceivableOrders, type PurchaseOrderSummary } from "./use-purchasing";

// The receiving desk. A warehouse keeper (goods_receipt:create, no purchase-order access) picks an open
// order and posts what physically arrived; the order list and detail come from the receiving endpoints.
export function GoodsReceivingPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = useReceivableOrders();
  const orders = data?.pages.flatMap((page) => page.data) ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInfo | null>(null);
  const selected = useReceivableOrder(selectedId);

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("purchasing.receiving.title")}</h1>
          <p className="erp-page__subtitle">{t("purchasing.receiving.subtitle")}</p>
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
          <DataGrid more={{ hasMore: hasNextPage, loading: isFetchingNextPage, error: isFetchNextPageError, onLoadMore: () => void fetchNextPage() }} value={orders} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("purchasing.receiving.empty")}>
            <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(row: PurchaseOrderSummary) => <span className="coa-code">{row.number}</span>} />
            <Column header={t("purchasing.supplier")} body={(row: PurchaseOrderSummary) => localizedName({ name: row.supplierName, nameAr: row.supplierNameAr }, i18n.language)} />
            <Column header={t("created.warehouse")} body={(row: PurchaseOrderSummary) => (row.warehouseName ? localizedName({ name: row.warehouseName, nameAr: row.warehouseNameAr }, i18n.language) : "—")} />
            <Column header={t("purchasing.orders.expectedDate")} style={{ width: "9rem" }} body={(row: PurchaseOrderSummary) => (row.expectedDate ? formatCalendarDate(row.expectedDate, i18n.language) : "")} />
            <Column header={t("purchasing.status")} style={{ width: "11rem" }} body={(row: PurchaseOrderSummary) => <OrderStatusTag status={row.status} />} />
            <Column
              header=""
              style={{ width: "11rem" }}
              body={(row: PurchaseOrderSummary) => <Button label={t("purchasing.orders.receive")} icon="pi pi-download" loading={selectedId === row.id && selected.isPending} onClick={() => setSelectedId(row.id)} />}
            />
          </DataGrid>
        </>
      )}
      {selected.data ? <ReceiveDialog order={selected.data} visible onHide={() => setSelectedId(null)} onCreated={setCreated} /> : null}
      <CreatedDialog info={created} onHide={() => setCreated(null)} />
    </div>
  );
}
