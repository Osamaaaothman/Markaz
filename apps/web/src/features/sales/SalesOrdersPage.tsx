import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataGrid } from "../../shared/ui/DataGrid";
import { Dropdown } from "primereact/dropdown";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useCancelSalesOrder, useSalesOrder, useSalesOrders, type SalesLineView, type SalesOrderStatus, type SalesOrderSummary } from "./use-sales";

const ALL = "ALL";
const STATUSES: readonly SalesOrderStatus[] = ["OPEN", "PARTIALLY_INVOICED", "INVOICED", "CANCELLED"];
const SEVERITY: Record<SalesOrderStatus, "info" | "warning" | "success" | "secondary"> = { OPEN: "info", PARTIALLY_INVOICED: "warning", INVOICED: "success", CANCELLED: "secondary" };

export function SalesOrdersPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SalesOrderStatus | null>(null);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useSalesOrders(status);
  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("sales.orders.title")}</h1>
          <p className="erp-page__subtitle">{t("sales.orders.subtitle")}</p>
        </div>
        <PermissionButton allowed={can("sales_order:create")} label={t("sales.orders.new")} icon="pi pi-plus" onClick={() => void navigate("/sales/orders/new")} />
      </div>

      <div className="coa-toolbar">
        <div className="coa-levels">
          <span className="coa-levels__label">{t("purchasing.status")}</span>
          <Dropdown
            value={status ?? ALL}
            onChange={(e) => setStatus(e.value === ALL ? null : (e.value as SalesOrderStatus))}
            options={[{ label: t("purchasing.allStatuses"), value: ALL }, ...STATUSES.map((s) => ({ label: t(`sales.orders.status.${s}`), value: s }))]}
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
          <DataGrid value={rows} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")} selectionMode="single" onRowClick={(e) => void navigate(`/sales/orders/${(e.data as SalesOrderSummary).id}`)}>
            <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(r: SalesOrderSummary) => <span className="coa-code">{r.number}</span>} />
            <Column header={t("sales.customer")} body={(r: SalesOrderSummary) => localizedName({ name: r.customerName, nameAr: r.customerNameAr }, i18n.language)} />
            <Column header={t("sales.orders.date")} style={{ width: "9rem" }} body={(r: SalesOrderSummary) => formatCalendarDate(r.orderDate, i18n.language)} />
            <Column header={t("purchasing.invoices.gross")} align="right" style={{ width: "11rem" }} body={(r: SalesOrderSummary) => formatMoney(r.totalGross, r.currency)} />
            <Column header={t("purchasing.status")} style={{ width: "11rem" }} body={(r: SalesOrderSummary) => <Tag value={t(`sales.orders.status.${r.status}`)} severity={SEVERITY[r.status]} />} />
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

export function SalesOrderDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { data: order, isPending, isError, refetch } = useSalesOrder(id);
  const cancel = useCancelSalesOrder(id);

  if (isPending) return <PageSkeleton />;
  if (isError || !order) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }
  const canInvoice = order.status === "OPEN" || order.status === "PARTIALLY_INVOICED";

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{order.number}</h1>
          <p className="erp-page__subtitle">{localizedName({ name: order.customerName, nameAr: order.customerNameAr }, i18n.language)}</p>
        </div>
        <div className="erp-page__header-actions">
          <Tag value={t(`sales.orders.status.${order.status}`)} severity={SEVERITY[order.status]} />
          {canInvoice ? <PermissionButton allowed={can("sales_invoice:create")} label={t("sales.orders.createInvoice")} icon="pi pi-receipt" onClick={() => void navigate(`/sales/invoices/new?order=${order.id}`)} /> : null}
          {order.status === "OPEN" ? (
            <PermissionButton allowed={can("sales_order:cancel")} label={t("sales.orders.cancel")} icon="pi pi-ban" severity="secondary" outlined loading={cancel.isPending} onClick={() => cancel.mutate(undefined, { onSuccess: () => void navigate("/sales/orders") })} />
          ) : null}
        </div>
      </div>
      {cancel.isError ? <p className="erp-auth-card__error">{t("sales.errors.generic")}</p> : null}
      {order.notes ? <p>{order.notes}</p> : null}

      <DataGrid value={[...order.lines]} className="erp-table" stripedRows showGridlines size="small">
        <Column header={t("sales.description")} body={(l: SalesLineView) => l.description} />
        <Column header={t("purchasing.quantity")} align="right" body={(l: SalesLineView) => l.quantity} />
        <Column header={t("sales.invoiced")} align="right" body={(l: SalesLineView) => l.invoicedQuantity ?? "0.0000"} />
        <Column header={t("purchasing.unitPrice")} align="right" body={(l: SalesLineView) => formatMoney(l.unitPrice, order.currency)} />
        <Column header={t("purchasing.invoices.net")} align="right" body={(l: SalesLineView) => formatMoney(l.netAmount, order.currency)} />
        <Column header={t("purchasing.invoices.tax")} align="right" body={(l: SalesLineView) => formatMoney(l.taxAmount, order.currency)} />
      </DataGrid>
      <div className="erp-table-footer">
        <span>
          {t("purchasing.invoices.gross")}: <strong>{formatMoney(order.totalGross, order.currency)}</strong>
        </span>
      </div>
      <div className="erp-form__actions">
        <Button type="button" label={t("sales.orders.back")} text onClick={() => void navigate("/sales/orders")} />
      </div>
    </div>
  );
}
