import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import type { CreatedInfo } from "../../shared/ui/CreatedDialog";
import { useAllWarehouses } from "../inventory/use-warehouses";
import { useReceiveOrder, type PurchaseOrderDetail, type PurchaseOrderLine } from "./use-purchasing";

const QTY = /^\d{1,15}(\.\d{1,4})?$/;

// Quantity still to receive on a line, as a plain decimal string ("6", "2.5").
function outstanding(line: PurchaseOrderLine): string {
  const left = Number(line.quantity) - Number(line.receivedQuantity);
  return left > 0 ? String(Number(left.toFixed(4))) : "0";
}

// A quantity cell inside a PrimeReact table. The table does not re-render its cells when the parent's
// state changes, so a value the parent passes down stays stale and the field shows nothing while the user
// types. This input keeps what is shown in its own state and only reports the value upward; the dialog
// is unmounted when closed, so it starts from `initial` each time it opens.
function QuantityInput({ initial, disabled, onValue }: { initial: string; disabled: boolean; onValue: (value: string) => void }): React.JSX.Element {
  const [text, setText] = useState(initial);
  return (
    <InputText
      dir="ltr"
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        onValue(e.target.value);
      }}
    />
  );
}

export function ReceiveDialog({
  order,
  visible,
  onHide,
  onCreated,
}: {
  order: PurchaseOrderDetail;
  visible: boolean;
  onHide: () => void;
  onCreated: (info: CreatedInfo) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: warehouses } = useAllWarehouses();
  const receive = useReceiveOrder(order.id);
  // The order already names the warehouse the goods are for; it is offered first and can still be changed.
  const [warehouseId, setWarehouseId] = useState(order.warehouseId ?? "");
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
          <Column header={t("inventory.items.displayName")} body={(l: PurchaseOrderLine) => `${l.itemCode} — ${localizedName({ name: l.itemName, nameAr: l.itemNameAr }, i18n.language)}`} />
          <Column header={t("purchasing.outstanding")} align="right" style={{ width: "8rem" }} body={(l: PurchaseOrderLine) => outstanding(l)} />
          <Column
            header={t("purchasing.receiveNow")}
            style={{ width: "10rem" }}
            body={(l: PurchaseOrderLine) => (
              <QuantityInput
                initial={outstanding(l)}
                disabled={outstanding(l) === "0"}
                onValue={(value) => setQuantities((prev) => ({ ...prev, [l.id]: value }))}
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
                {
                  onSuccess: (saved) => {
                    onHide();
                    const warehouse = warehouses?.find((w) => w.id === warehouseId);
                    onCreated({
                      title: t("purchasing.orders.receiveTitle"),
                      headline: saved.number,
                      onOpen: () => void navigate(`/inventory/goods-receipts/${saved.id}`),
                      rows: [
                        { label: t("inventory.warehouses.title"), value: warehouse ? localizedName(warehouse, i18n.language) : "" },
                        { label: t("created.date"), value: toDateOnlyIsoString(date), ltr: true },
                        { label: t("created.reference"), value: reference.trim() },
                        { label: t("created.lines"), value: String(chosen.length) },
                      ],
                    });
                  },
                },
              )
            }
          />
        </div>
      </div>
    </Dialog>
  );
}
