import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate, toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useAllWarehouses } from "../inventory/use-warehouses";
import { OrderStatusTag } from "./StatusTags";
import { useOrderAction, usePurchaseOrder, useReceiveOrder, type PurchaseOrderDetail, type PurchaseOrderLine } from "./use-purchasing";
import { AttachmentsButton } from "../attachments/AttachmentsButton";

const QTY = /^\d{1,15}(\.\d{1,4})?$/;

// Quantity still to receive on a line, as a plain decimal string ("6", "2.5").
function outstanding(line: PurchaseOrderLine): string {
  const left = Number(line.quantity) - Number(line.receivedQuantity);
  return left > 0 ? String(Number(left.toFixed(4))) : "0";
}

export function PurchaseOrderDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { data: order, isPending, isError, refetch } = usePurchaseOrder(id);
  const approve = useOrderAction(id, "approve");
  const reject = useOrderAction(id, "reject");
  const cancel = useOrderAction(id, "cancel");
  const [receiveOpen, setReceiveOpen] = useState(false);

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

  const canReceive = order.status === "APPROVED" || order.status === "PARTIALLY_RECEIVED";
  const actionError = approve.isError || reject.isError || cancel.isError;

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{order.number}</h1>
          <p className="erp-page__subtitle">{localizedName({ name: order.supplierName, nameAr: order.supplierNameAr }, i18n.language)}</p>
        </div>
        <div className="erp-page__header-actions">
          <OrderStatusTag status={order.status} />
          <AttachmentsButton ownerType="PURCHASE_ORDER" ownerId={order.id} label={order.number} />
          {order.status === "PENDING_APPROVAL" ? (
            <>
              <PermissionButton allowed={can("purchase_order:approve")} label={t("purchasing.orders.approve")} icon="pi pi-check" loading={approve.isPending} onClick={() => approve.mutate(undefined)} />
              <PermissionButton allowed={can("purchase_order:approve")} label={t("purchasing.orders.reject")} icon="pi pi-times" severity="danger" outlined loading={reject.isPending} onClick={() => reject.mutate(undefined)} />
            </>
          ) : null}
          {canReceive ? (
            <PermissionButton allowed={can("goods_receipt:create")} label={t("purchasing.orders.receive")} icon="pi pi-download" onClick={() => setReceiveOpen(true)} />
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
          <label>{t("purchasing.total")}</label>
          <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
        </div>
      </div>
      {order.notes ? <p>{order.notes}</p> : null}

      <h3 className="erp-form__section-title">{t("purchasing.lines")}</h3>
      <DataTable value={[...order.lines]} className="erp-table" stripedRows showGridlines size="small">
        <Column header={t("inventory.items.code")} style={{ width: "8rem" }} body={(l: PurchaseOrderLine) => <span className="coa-code">{l.itemCode}</span>} />
        <Column header={t("inventory.items.name")} body={(l: PurchaseOrderLine) => localizedName({ name: l.itemName, nameAr: l.itemNameAr }, i18n.language)} />
        <Column header={t("purchasing.quantity")} align="right" body={(l: PurchaseOrderLine) => `${l.quantity} ${l.unit}`} />
        <Column header={t("purchasing.received")} align="right" body={(l: PurchaseOrderLine) => l.receivedQuantity} />
        <Column header={t("purchasing.unitPrice")} align="right" body={(l: PurchaseOrderLine) => formatMoney(l.unitPrice, order.currency)} />
        <Column header={t("purchasing.total")} align="right" body={(l: PurchaseOrderLine) => formatMoney(l.lineTotal, order.currency)} />
      </DataTable>

      <div className="erp-form__actions">
        <Button type="button" label={t("purchasing.orders.backToList")} text onClick={() => void navigate("/purchasing/orders")} />
      </div>

      <ReceiveDialog order={order} visible={receiveOpen} onHide={() => setReceiveOpen(false)} />
    </div>
  );
}

function ReceiveDialog({ order, visible, onHide }: { order: PurchaseOrderDetail; visible: boolean; onHide: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data: warehouses } = useAllWarehouses();
  const receive = useReceiveOrder(order.id);
  const [warehouseId, setWarehouseId] = useState("");
  const [date, setDate] = useState<Date>(new Date());
  const [reference, setReference] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible) return;
    receive.reset();
    setDate(new Date());
    setReference("");
    setQuantities(Object.fromEntries(order.lines.map((l) => [l.id, outstanding(l)])));
    // Prefill with what is still outstanding each time the dialog opens.
  }, [visible, order.id, order.status]);

  const chosen = order.lines.flatMap((l) => {
    const quantity = quantities[l.id] ?? "";
    return QTY.test(quantity) && /[1-9]/.test(quantity) ? [{ purchaseOrderLineId: l.id, quantity }] : [];
  });
  const hasBadInput = order.lines.some((l) => {
    const q = quantities[l.id] ?? "";
    return q !== "" && q !== "0" && !QTY.test(q);
  });
  const status = (receive.error as { response?: { status?: number } } | null)?.response?.status;

  return (
    <Dialog header={t("purchasing.orders.receiveTitle")} visible={visible} onHide={onHide} className="erp-dialog" modal style={{ width: "min(46rem, 96vw)" }}>
      <div className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="recvWarehouse">{t("inventory.warehouses.title")}</label>
            <Dropdown
              inputId="recvWarehouse"
              value={warehouseId || null}
              onChange={(e) => setWarehouseId((e.value as string | null) ?? "")}
              options={(warehouses ?? []).map((w) => ({ label: localizedName(w, i18n.language), value: w.id }))}
              filter
            />
          </div>
          <div className="erp-field">
            <label htmlFor="recvDate">{t("inventory.goodsReceipt.documentDate")}</label>
            <Calendar inputId="recvDate" value={date} onChange={(e) => e.value && setDate(e.value)} dateFormat="yy-mm-dd" />
          </div>
          <div className="erp-field">
            <label htmlFor="recvRef">{t("inventory.goodsReceipt.reference")}</label>
            <InputText id="recvRef" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>

        <DataTable value={[...order.lines]} className="erp-table" size="small" showGridlines>
          <Column header={t("inventory.items.name")} body={(l: PurchaseOrderLine) => `${l.itemCode} — ${localizedName({ name: l.itemName, nameAr: l.itemNameAr }, i18n.language)}`} />
          <Column header={t("purchasing.outstanding")} align="right" style={{ width: "8rem" }} body={(l: PurchaseOrderLine) => outstanding(l)} />
          <Column
            header={t("purchasing.receiveNow")}
            style={{ width: "10rem" }}
            body={(l: PurchaseOrderLine) => (
              <InputText
                dir="ltr"
                value={quantities[l.id] ?? ""}
                disabled={outstanding(l) === "0"}
                onChange={(e) => setQuantities((prev) => ({ ...prev, [l.id]: e.target.value }))}
              />
            )}
          />
        </DataTable>

        {receive.isError ? (
          <p className="erp-auth-card__error">{status === 409 ? t("purchasing.orders.receiveConflict") : t("purchasing.orders.receiveError")}</p>
        ) : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
          <Button
            type="button"
            label={t("purchasing.orders.postReceipt")}
            disabled={!warehouseId || chosen.length === 0 || hasBadInput}
            loading={receive.isPending}
            onClick={() =>
              receive.mutate(
                { warehouseId, documentDate: toDateOnlyIsoString(date), ...(reference.trim() ? { reference: reference.trim() } : {}), lines: chosen },
                { onSuccess: onHide },
              )
            }
          />
        </div>
      </div>
    </Dialog>
  );
}
