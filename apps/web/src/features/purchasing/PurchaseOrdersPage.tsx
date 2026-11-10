import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataGrid } from "../../shared/ui/DataGrid";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { OrderStatusTag } from "./StatusTags";
import { usePurchaseOrders, usePurchaseRequests, type PurchaseRequestSummary, type PurchaseOrderStatus, type PurchaseOrderSummary } from "./use-purchasing";
import { AttachmentsButton } from "../attachments/AttachmentsButton";

const ALL = "ALL";
const STATUSES: readonly PurchaseOrderStatus[] = ["PENDING_APPROVAL", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "REJECTED", "CANCELLED"];

export function PurchaseOrdersPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PurchaseOrderStatus | null>(null);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = usePurchaseOrders(status);
  const orders = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("purchasing.orders.title")}</h1>
          <p className="erp-page__subtitle">{t("purchasing.orders.subtitle")}</p>
        </div>
        <div className="erp-page__header-actions">
          <PermissionButton allowed={can("purchase_order:create") && can("purchase_request:read")} label={t("purchasing.orders.acceptedRequests")} icon="pi pi-list-check" outlined onClick={() => setRequestsOpen(true)} />
          <PermissionButton allowed={can("purchase_order:create")} label={t("purchasing.orders.new")} icon="pi pi-plus" onClick={() => void navigate("/purchasing/orders/new")} />
        </div>
      </div>

      <div className="coa-toolbar">
        <div className="coa-levels">
          <span className="coa-levels__label">{t("purchasing.status")}</span>
          <Dropdown
            value={status ?? ALL}
            onChange={(e) => setStatus(e.value === ALL ? null : (e.value as PurchaseOrderStatus))}
            options={[
              { label: t("purchasing.allStatuses"), value: ALL },
              ...STATUSES.map((s) => ({ label: t(`purchasing.orderStatus.${s}`), value: s })),
            ]}
          />
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
          <DataGrid emptyAction={{ allowed: can("purchase_order:create"), label: t("purchasing.orders.new"), onClick: () => void navigate("/purchasing/orders/new") }}
            value={orders}
            className="erp-table"
            stripedRows
            showGridlines
            size="small"
            emptyMessage={t("status.empty")}
            selectionMode="single"
            onRowClick={(e) => void navigate(`/purchasing/orders/${(e.data as PurchaseOrderSummary).id}`)}
          >
            <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(row: PurchaseOrderSummary) => <span className="coa-code">{row.number}</span>} />
            <Column header={t("purchasing.supplier")} body={(row: PurchaseOrderSummary) => localizedName({ name: row.supplierName, nameAr: row.supplierNameAr }, i18n.language)} />
            <Column header={t("created.warehouse")} body={(row: PurchaseOrderSummary) => (row.warehouseName ? localizedName({ name: row.warehouseName, nameAr: row.warehouseNameAr }, i18n.language) : "—")} />
            <Column header={t("purchasing.orders.orderDate")} style={{ width: "9rem" }} body={(row: PurchaseOrderSummary) => formatCalendarDate(row.orderDate, i18n.language)} />
            <Column header={t("purchasing.orders.expectedDate")} style={{ width: "9rem" }} body={(row: PurchaseOrderSummary) => (row.expectedDate ? formatCalendarDate(row.expectedDate, i18n.language) : "")} />
            <Column header={t("purchasing.total")} align="right" style={{ width: "11rem" }} body={(row: PurchaseOrderSummary) => formatMoney(row.totalAmount, row.currency)} />
            <Column header={t("purchasing.status")} style={{ width: "11rem" }} body={(row: PurchaseOrderSummary) => <OrderStatusTag status={row.status} />} />
            <Column header="" style={{ width: "4rem" }} body={(row: PurchaseOrderSummary) => <AttachmentsButton ownerType="PURCHASE_ORDER" ownerId={row.id} label={row.number} />} />
          </DataGrid>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}
      {requestsOpen ? <AcceptedRequestsDialog onHide={() => setRequestsOpen(false)} /> : null}
    </div>
  );
}

function AcceptedRequestsDialog({ onHide }: { readonly onHide: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = usePurchaseRequests("ACCEPTED");
  const requests = data?.pages.flatMap((page) => page.data).filter((request) => request.status === "ACCEPTED" && !request.purchaseOrderId) ?? [];
  const choose = (request: PurchaseRequestSummary): void => {
    onHide();
    void navigate(`/purchasing/orders/new?request=${encodeURIComponent(request.id)}`);
  };
  return (
    <Dialog header={t("purchasing.orders.acceptedRequests")} visible onHide={onHide} className="erp-dialog" modal>
      <p>{t("purchasing.orders.acceptedRequestsHint")}</p>
      {isPending ? <PageSkeleton /> : isError ? (
        <div role="alert">
          <p className="erp-page__error">{t("status.error")}</p>
          <Button label={t("actions.retry")} onClick={() => void refetch()} />
        </div>
      ) : (
        <>
          <DataGrid value={requests} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("purchasing.orders.noAcceptedRequests")} selectionMode="single" onRowClick={(event) => choose(event.data as PurchaseRequestSummary)}>
            <Column header={t("purchasing.number")} field="number" />
            <Column header={t("purchasing.date")} body={(row: PurchaseRequestSummary) => formatCalendarDate(row.createdAt, i18n.language)} />
            <Column header={t("created.warehouse")} body={(row: PurchaseRequestSummary) => row.warehouseName ? localizedName({ name: row.warehouseName, nameAr: row.warehouseNameAr }, i18n.language) : "—"} />
            <Column header={t("purchasing.lineCount")} field="lineCount" />
            <Column header={t("purchasing.notes")} field="notes" />
            <Column header="" body={(row: PurchaseRequestSummary) => <Button label={t("purchasing.orders.useRequest")} icon="pi pi-plus" onClick={(event) => { event.stopPropagation(); choose(row); }} />} />
          </DataGrid>
          {hasNextPage ? <Button label={t("actions.loadMore")} text loading={isFetchingNextPage} onClick={() => void fetchNextPage()} /> : null}
        </>
      )}
    </Dialog>
  );
}
