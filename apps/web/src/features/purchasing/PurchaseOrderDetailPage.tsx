import { DocumentTrail } from "../documents/DocumentTrail";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Money, tafqeetAmount } from "@erp/shared";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useStockLevels, type StockLevelEntry } from "../inventory/use-stock-levels";
import { OrderStatusTag } from "./StatusTags";
import { useOrderAction, usePurchaseOrder, type PurchaseOrderLine } from "./use-purchasing";
import { AttachmentsButton } from "../attachments/AttachmentsButton";
import { exportReport } from "../accounting/export-report";

export function PurchaseOrderDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { data: order, isPending, isError, refetch } = usePurchaseOrder(id);
  // On-hand stock in the order's warehouse, so an approver can see a line that would be approved
  // against little or no stock. Fetched for the warehouse and matched per item here; the endpoint
  // has no item filter and the hook is a no-op for users without stock:read.
  const stockQuery = useStockLevels({ warehouseId: order?.warehouseId ?? null, belowReorderOnly: false });
  const stockLevels = stockQuery.isError ? undefined : stockQuery.data;
  const approve = useOrderAction(id, "approve");
  const reject = useOrderAction(id, "reject");
  const cancel = useOrderAction(id, "cancel");

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

  // The stock column goes with the approve/reject buttons: it is only useful while the order waits
  // for approval, and only when the order names a warehouse to check.
  const showStock = order.status === "PENDING_APPROVAL" && Boolean(order.warehouseId);
  const stockByItem = new Map<string, StockLevelEntry>((stockLevels ?? []).map((s) => [s.itemId, s]));
  const actionError = approve.isError || reject.isError || cancel.isError;
  const totalGross = Money.of(order.totalAmount, order.currency).add(Money.of(order.totalTax, order.currency));

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{order.number}</h1>
          <p className="erp-page__subtitle">
            {localizedName({ name: order.supplierName, nameAr: order.supplierNameAr }, i18n.language)}
            {order.warehouseName ? ` · ${t("created.warehouse")}: ${localizedName({ name: order.warehouseName, nameAr: order.warehouseNameAr }, i18n.language)}` : ""}
          </p>
        </div>
        <div className="erp-page__header-actions">
          <OrderStatusTag status={order.status} />
          <AttachmentsButton ownerType="PURCHASE_ORDER" ownerId={order.id} label={order.number} />
          <Button label={t("actions.exportPdf")} icon="pi pi-file-pdf" outlined onClick={() => void exportReport(`/v1/purchase-orders/${order.id}/pdf`, { lang: i18n.language }, order.number, "pdf")} />
          <Button label={t("actions.print")} icon="pi pi-print" outlined onClick={() => void exportReport(`/v1/purchase-orders/${order.id}/pdf`, { lang: i18n.language }, order.number, "print")} />
          {order.status === "PENDING_APPROVAL" ? (
            <>
              <PermissionButton allowed={can("purchase_order:approve")} label={t("purchasing.orders.approve")} icon="pi pi-check" loading={approve.isPending} onClick={() => approve.mutate(undefined)} />
              <PermissionButton allowed={can("purchase_order:approve")} label={t("purchasing.orders.reject")} icon="pi pi-times" severity="danger" outlined loading={reject.isPending} onClick={() => reject.mutate(undefined)} />
            </>
          ) : null}
          {order.status === "PENDING_APPROVAL" || order.status === "APPROVED" ? (
            <PermissionButton allowed={can("purchase_order:cancel")} label={t("purchasing.orders.cancel")} icon="pi pi-ban" severity="secondary" outlined loading={cancel.isPending} onClick={() => cancel.mutate(undefined)} />
          ) : null}
        </div>
      </div>

      {order.status === "PENDING_APPROVAL" ? <p className="erp-field__hint">{t("purchasing.orders.waitingApproval")}</p> : null}
      {actionError ? <p className="erp-auth-card__error">{t("purchasing.orders.actionError")}</p> : null}

      <div className="erp-form__row">
        <div className="erp-field">
          <label>{t("purchasing.orders.orderDate")}</label>
          <span>{formatCalendarDate(order.orderDate, i18n.language)}</span>
        </div>
        <div className="erp-field">
          <label>{t("purchasing.orders.expectedDate")}</label>
          <span>{order.expectedDate ? formatCalendarDate(order.expectedDate, i18n.language) : "—"}</span>
        </div>
        <div className="erp-field">
          <label>{t("purchasing.invoices.net")}</label>
          <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
        </div>
        <div className="erp-field">
          <label>{t("purchasing.invoices.tax")}</label>
          <strong>{formatMoney(order.totalTax, order.currency)}</strong>
        </div>
        <div className="erp-field">
          <label>{t("purchasing.invoices.gross")}</label>
          <strong>{formatMoney(totalGross.toDecimalString(), order.currency)}</strong>
        </div>
        <div className="erp-field">
          <label>{t("created.inWords")}</label>
          <strong>{tafqeetAmount(totalGross.toDecimalString(), order.currency, i18n.language)}</strong>
        </div>
      </div>
      {order.notes ? <p>{order.notes}</p> : null}

      <h3 className="erp-form__section-title">{t("purchasing.lines")}</h3>
      <DataTable value={[...order.lines]} className="erp-table" stripedRows showGridlines size="small">
        <Column header={t("inventory.items.code")} style={{ width: "8rem" }} body={(l: PurchaseOrderLine) => <span className="coa-code">{l.itemCode}</span>} />
        <Column header={t("inventory.items.displayName")} body={(l: PurchaseOrderLine) => localizedName({ name: l.itemName, nameAr: l.itemNameAr }, i18n.language)} />
        <Column header={t("purchasing.quantity")} align="right" body={(l: PurchaseOrderLine) => `${l.quantity} ${l.unit}`} />
        <Column header={t("purchasing.received")} align="right" body={(l: PurchaseOrderLine) => l.receivedQuantity} />
        {showStock ? (
          <Column
            header={t("purchasing.orders.currentStock")}
            align="right"
            style={{ width: "9rem" }}
            body={(l: PurchaseOrderLine) => {
              const entry = stockByItem.get(l.itemId);
              // No row from /v1/stock-levels means nothing recorded for this item in this warehouse.
              if (!entry) return <strong className="erp-field__warning">—</strong>;
              return entry.belowReorderPoint ? <strong className="erp-field__warning">{entry.quantity}</strong> : entry.quantity;
            }}
          />
        ) : null}
        <Column header={t("purchasing.unitPrice")} align="right" body={(l: PurchaseOrderLine) => formatMoney(l.unitPrice, order.currency)} />
        <Column header={t("purchasing.total")} align="right" body={(l: PurchaseOrderLine) => formatMoney(l.lineTotal, order.currency)} />
        <Column header={t("purchasing.invoices.tax")} align="right" body={(l: PurchaseOrderLine) => formatMoney(l.taxAmount, order.currency)} />
      </DataTable>

      <div className="erp-form__actions">
        <Button type="button" label={t("purchasing.orders.backToList")} text onClick={() => void navigate("/purchasing/orders")} />
      </div>

    <DocumentTrail kind="purchase_order" id={id} />
    </div>
  );
}
