import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate, toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { DataGrid } from "../../shared/ui/DataGrid";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { CreatedDialog, type CreatedInfo } from "../../shared/ui/CreatedDialog";
import { exportReport } from "../accounting/export-report";
import {
  useCreateGoodsDeliveryNote,
  useGoodsDeliveryNote,
  useGoodsDeliveryNotes,
  useSalesOrder,
  useSalesOrders,
  type GoodsDeliveryNoteLineView,
  type GoodsDeliveryNoteSummary,
  type SalesLineView,
  type SalesOrderSummary,
} from "./use-sales";

const QTY = /^\d{1,15}(\.\d{1,4})?$/;

// Quantity still to deliver on a line, as a plain decimal string ("6", "2.5").
function outstanding(line: SalesLineView): string {
  const left = Number(line.quantity) - Number(line.deliveredQuantity ?? "0");
  return left > 0 ? String(Number(left.toFixed(4))) : "0";
}

// Every delivery note made so far, newest first — a storekeeper's handover record, no prices
// (docs/01-OPEN-DECISIONS.md E1).
export function GoodsDeliveryNotesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useGoodsDeliveryNotes(null);
  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("sales.deliveryNotes.title")}</h1>
          <p className="erp-page__subtitle">{t("sales.deliveryNotes.subtitle")}</p>
        </div>
        <PermissionButton allowed={can("sales_delivery_note:create")} label={t("sales.deliveryNotes.new")} icon="pi pi-plus" onClick={() => void navigate("/sales/delivery-notes/new")} />
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
            emptyAction={{ allowed: can("sales_delivery_note:create"), label: t("sales.deliveryNotes.new"), onClick: () => void navigate("/sales/delivery-notes/new") }}
            value={rows}
            className="erp-table"
            stripedRows
            showGridlines
            size="small"
            emptyMessage={t("status.empty")}
            selectionMode="single"
            onRowClick={(e) => void navigate(`/sales/delivery-notes/${(e.data as GoodsDeliveryNoteSummary).id}`)}
          >
            <Column field="number" header={t("purchasing.number")} style={{ width: "13rem" }} body={(r: GoodsDeliveryNoteSummary) => <span className="coa-code">{r.number}</span>} />
            <Column header={t("sales.customer")} body={(r: GoodsDeliveryNoteSummary) => localizedName({ name: r.customerName, nameAr: r.customerNameAr }, i18n.language)} />
            <Column header={t("documents.salesOrder")} style={{ width: "12rem" }} body={(r: GoodsDeliveryNoteSummary) => r.salesOrderNumber} />
            <Column header={t("sales.deliveryNotes.date")} style={{ width: "9rem" }} body={(r: GoodsDeliveryNoteSummary) => formatCalendarDate(r.deliveryDate, i18n.language)} />
            <Column header={t("sales.deliveryNotes.driverName")} body={(r: GoodsDeliveryNoteSummary) => r.driverName ?? "—"} />
            <Column header={t("sales.deliveryNotes.receiverName")} body={(r: GoodsDeliveryNoteSummary) => r.receiverName ?? "—"} />
            <Column header={t("inventory.stockCount.lineCount")} align="right" style={{ width: "6rem" }} body={(r: GoodsDeliveryNoteSummary) => r.lineCount} />
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

export function GoodsDeliveryNoteDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: note, isPending, isError, refetch } = useGoodsDeliveryNote(id);

  if (isPending) return <PageSkeleton />;
  if (isError || !note) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{note.number}</h1>
          <p className="erp-page__subtitle">{localizedName({ name: note.customerName, nameAr: note.customerNameAr }, i18n.language)}</p>
        </div>
        <div className="erp-page__header-actions">
          <Button label={t("actions.exportPdf")} icon="pi pi-file-pdf" outlined onClick={() => void exportReport(`/v1/goods-delivery-notes/${note.id}/pdf`, { lang: i18n.language }, note.number, "pdf")} />
          <Button label={t("actions.print")} icon="pi pi-print" outlined onClick={() => void exportReport(`/v1/goods-delivery-notes/${note.id}/pdf`, { lang: i18n.language }, note.number, "print")} />
        </div>
      </div>

      <dl className="mk-facts">
        <div>
          <dt>{t("sales.deliveryNotes.date")}</dt>
          <dd>{formatCalendarDate(note.deliveryDate, i18n.language)}</dd>
        </div>
        <div>
          <dt>{t("documents.salesOrder")}</dt>
          <dd>
            <button type="button" className="erp-button-link" onClick={() => void navigate(`/sales/orders/${note.salesOrderId}`)}>
              {note.salesOrderNumber}
            </button>
          </dd>
        </div>
        <div>
          <dt>{t("sales.deliveryNotes.driverName")}</dt>
          <dd>{note.driverName ?? "—"}</dd>
        </div>
        <div>
          <dt>{t("sales.deliveryNotes.receiverName")}</dt>
          <dd>{note.receiverName ?? "—"}</dd>
        </div>
      </dl>
      {note.notes ? <p>{note.notes}</p> : null}

      <DataGrid value={[...note.lines]} className="erp-table" stripedRows showGridlines size="small">
        <Column header={t("inventory.items.displayName")} body={(l: GoodsDeliveryNoteLineView) => (l.itemCode ? `${l.itemCode} — ${localizedName({ name: l.itemName ?? l.description, nameAr: l.itemNameAr }, i18n.language)}` : l.description)} />
        <Column header={t("purchasing.quantity")} align="right" body={(l: GoodsDeliveryNoteLineView) => l.quantity} />
      </DataGrid>

      <div className="erp-form__actions">
        <Button type="button" label={t("sales.orders.back")} text onClick={() => void navigate("/sales/delivery-notes")} />
      </div>
    </div>
  );
}

// Starts a delivery note against a sales order (?order=<id>), or lets the storekeeper pick one
// first. Lines come straight from the order's own lines, each prefilled with what is still
// outstanding — the same shape as receiving goods against a purchase order.
export function GoodsDeliveryNoteFormPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [pickedOrderId, setPickedOrderId] = useState("");
  const orderId = params.get("order") || pickedOrderId || null;

  const { data: order, isPending } = useSalesOrder(orderId);
  const { data: ordersData } = useSalesOrders(null);
  const pickableOrders = (ordersData?.pages.flatMap((p) => p.data) ?? []).filter((o) => o.status !== "CANCELLED");

  const [date, setDate] = useState<Date>(new Date());
  const [driverName, setDriverName] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ info: CreatedInfo; to: string } | null>(null);
  const create = useCreateGoodsDeliveryNote();

  if (!orderId) {
    return (
      <div className="erp-page">
        <div className="erp-page__header">
          <h1 className="erp-page__title">{t("sales.deliveryNotes.new")}</h1>
        </div>
        <div className="erp-form">
          <div className="erp-field">
            <label htmlFor="dnOrder">{t("sales.orders.title")}</label>
            <Dropdown
              inputId="dnOrder"
              value={pickedOrderId || null}
              onChange={(e) => setPickedOrderId((e.value as string | null) ?? "")}
              options={pickableOrders.map((o: SalesOrderSummary) => ({
                label: `${o.number} — ${localizedName({ name: o.customerName, nameAr: o.customerNameAr }, i18n.language)}`,
                value: o.id,
              }))}
              filter
              placeholder={t("sales.orders.title")}
              emptyMessage={t("status.empty")}
            />
          </div>
          <div className="erp-form__actions">
            <Button type="button" label={t("sales.orders.back")} text onClick={() => void navigate("/sales/delivery-notes")} />
          </div>
        </div>
      </div>
    );
  }

  if (isPending || !order) return <PageSkeleton />;

  // Editable values belong to the row: PrimeReact memoizes cells against row data.
  const deliverableLines = order.lines.filter((l) => outstanding(l) !== "0").map((l) => ({
    ...l,
    deliveryQuantity: quantities[l.id] ?? outstanding(l),
  }));
  const chosen = deliverableLines.flatMap((l) => {
    const quantity = l.deliveryQuantity;
    return QTY.test(quantity) && /[1-9]/.test(quantity) ? [{ salesOrderLineId: l.id, quantity }] : [];
  });
  const hasBadInput = deliverableLines.some((l) => {
    const q = l.deliveryQuantity;
    return q !== "" && q !== "0" && !QTY.test(q);
  });

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("sales.deliveryNotes.new")}</h1>
          <p className="erp-page__subtitle">{order.number} — {localizedName({ name: order.customerName, nameAr: order.customerNameAr }, i18n.language)}</p>
        </div>
      </div>

      <div className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="dnDate">{t("sales.deliveryNotes.date")}</label>
            <Calendar inputId="dnDate" value={date} onChange={(e) => e.value && setDate(e.value)} dateFormat="yy-mm-dd" />
          </div>
          <div className="erp-field">
            <label htmlFor="dnDriver">{t("sales.deliveryNotes.driverName")}</label>
            <InputText id="dnDriver" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
          </div>
          <div className="erp-field">
            <label htmlFor="dnReceiver">{t("sales.deliveryNotes.receiverName")}</label>
            <InputText id="dnReceiver" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
          </div>
        </div>
        <div className="erp-field">
          <label htmlFor="dnNotes">{t("sales.deliveryNotes.notes")}</label>
          <InputTextarea id="dnNotes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        {deliverableLines.length === 0 ? (
          <p className="erp-page__error">{t("sales.deliveryNotes.nothingOutstanding")}</p>
        ) : (
          <DataTable value={deliverableLines} dataKey="id" className="erp-table" size="small" showGridlines>
            <Column header={t("sales.description")} body={(l: SalesLineView) => l.description} />
            <Column header={t("purchasing.outstanding")} align="right" style={{ width: "8rem" }} body={(l: SalesLineView) => outstanding(l)} />
            <Column
              header={t("sales.deliveryNotes.deliverNow")}
              style={{ width: "10rem" }}
              body={(l: (typeof deliverableLines)[number]) => (
                <InputText
                  dir="ltr"
                  inputMode="decimal"
                  aria-label={`${t("sales.deliveryNotes.deliverNow")}: ${l.description}`}
                  style={{ width: "100%", minWidth: "6rem" }}
                  value={l.deliveryQuantity}
                  onChange={(e) => setQuantities((prev) => ({ ...prev, [l.id]: e.target.value }))}
                />
              )}
            />
          </DataTable>
        )}

        {create.isError ? <p className="erp-auth-card__error">{t("sales.errors.generic")}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={() => void navigate("/sales/delivery-notes")} />
          <Button
            type="button"
            label={t("sales.deliveryNotes.post")}
            disabled={chosen.length === 0 || hasBadInput}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                {
                  salesOrderId: order.id,
                  deliveryDate: toDateOnlyIsoString(date),
                  ...(driverName.trim() ? { driverName: driverName.trim() } : {}),
                  ...(receiverName.trim() ? { receiverName: receiverName.trim() } : {}),
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                  lines: chosen,
                },
                {
                  onSuccess: (saved) => {
                    setCreated({
                      to: `/sales/delivery-notes/${saved.id}`,
                      info: {
                        title: t("sales.deliveryNotes.new"),
                        headline: saved.number,
                        rows: [
                          { label: t("created.date"), value: toDateOnlyIsoString(date), ltr: true },
                          { label: t("sales.deliveryNotes.driverName"), value: driverName.trim() },
                          { label: t("sales.deliveryNotes.receiverName"), value: receiverName.trim() },
                          { label: t("created.lines"), value: String(chosen.length) },
                        ].filter((row) => row.value !== ""),
                      },
                    });
                  },
                },
              )
            }
          />
        </div>
      </div>
      <CreatedDialog info={created?.info ?? null} onHide={() => created && void navigate(created.to)} />
    </div>
  );
}
