import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dropdown } from "primereact/dropdown";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { OrderStatusTag } from "./StatusTags";
import { usePurchaseOrders, type PurchaseOrderStatus, type PurchaseOrderSummary } from "./use-purchasing";

const ALL = "ALL";
const STATUSES: readonly PurchaseOrderStatus[] = ["PENDING_APPROVAL", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "REJECTED", "CANCELLED"];

export function PurchaseOrdersPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PurchaseOrderStatus | null>(null);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = usePurchaseOrders(status);
  const orders = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("purchasing.orders.title")}</h1>
          <p className="erp-page__subtitle">{t("purchasing.orders.subtitle")}</p>
        </div>
        <PermissionButton allowed={can("purchase_order:create")} label={t("purchasing.orders.new")} icon="pi pi-plus" onClick={() => void navigate("/purchasing/orders/new")} />
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
          <DataTable
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
            <Column header={t("purchasing.orders.orderDate")} style={{ width: "9rem" }} body={(row: PurchaseOrderSummary) => formatCalendarDate(row.orderDate, i18n.language)} />
            <Column header={t("purchasing.orders.expectedDate")} style={{ width: "9rem" }} body={(row: PurchaseOrderSummary) => (row.expectedDate ? formatCalendarDate(row.expectedDate, i18n.language) : "")} />
            <Column header={t("purchasing.total")} align="right" style={{ width: "11rem" }} body={(row: PurchaseOrderSummary) => formatMoney(row.totalAmount, row.currency)} />
            <Column header={t("purchasing.status")} style={{ width: "11rem" }} body={(row: PurchaseOrderSummary) => <OrderStatusTag status={row.status} />} />
          </DataTable>
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
