import { positiveReturnQuantity, validReturnQuantity } from "../../shared/lib/return-quantity";
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
import { Tag } from "primereact/tag";
import { DataGrid } from "../../shared/ui/DataGrid";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate, toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useAllWarehouses } from "../inventory/use-warehouses";
import { newId } from "@erp/shared";
import { useCreateDebitNote, useSupplierInvoice, useSupplierInvoices, type SupplierInvoiceLineDetail, type SupplierInvoiceSummary } from "./use-invoicing";
import { AttachmentsButton } from "../attachments/AttachmentsButton";

const ALL = "ALL";

export function SupplierInvoicesPage({ returnsOnly = false }: { returnsOnly?: boolean }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [type, setType] = useState<"INVOICE" | "DEBIT_NOTE" | null>(null);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useSupplierInvoices(returnsOnly ? "DEBIT_NOTE" : type);
  const invoices = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t(returnsOnly ? "returns.purchaseTitle" : "purchasing.invoices.title")}</h1>
          <p className="erp-page__subtitle">{t(returnsOnly ? "returns.purchaseHint" : "purchasing.invoices.subtitle")}</p>
        </div>
        {returnsOnly ? <PermissionButton allowed={can("debit_note:create")} label={t("returns.new")} icon="pi pi-plus" onClick={() => void navigate("/purchasing/invoices")} /> : <PermissionButton allowed={can("supplier_invoice:create")} label={t("purchasing.invoices.new")} icon="pi pi-plus" onClick={() => void navigate("/purchasing/invoices/new")} />}
      </div>

      {!returnsOnly ? <div className="coa-toolbar">
        <div className="coa-levels">
          <span className="coa-levels__label">{t("purchasing.invoices.documentType")}</span>
          <Dropdown
            value={type ?? ALL}
            onChange={(e) => setType(e.value === ALL ? null : (e.value as "INVOICE" | "DEBIT_NOTE"))}
            options={[
              { label: t("purchasing.invoices.allTypes"), value: ALL },
              { label: t("purchasing.invoices.types.INVOICE"), value: "INVOICE" },
              { label: t("purchasing.invoices.types.DEBIT_NOTE"), value: "DEBIT_NOTE" },
            ]}
          />
        </div>
      </div> : null}

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
          <DataGrid emptyAction={{ allowed: !returnsOnly && can("supplier_invoice:create"), label: t("purchasing.invoices.new"), onClick: () => void navigate("/purchasing/invoices/new") }} value={invoices} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
            <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(r: SupplierInvoiceSummary) => <button type="button" className="erp-button-link coa-code" onClick={() => void navigate(`/purchasing/invoices/${r.id}`)}>{r.number}</button>} />
            <Column header={t("purchasing.invoices.documentType")} style={{ width: "10rem" }} body={(r: SupplierInvoiceSummary) => <Tag value={t(`purchasing.invoices.types.${r.documentType}`)} severity={r.documentType === "INVOICE" ? "info" : "warning"} />} />
            <Column header={t("purchasing.invoices.supplierInvoiceNumber")} style={{ width: "12rem" }} body={(r: SupplierInvoiceSummary) => r.supplierInvoiceNumber ?? "—"} />
            <Column header={t("purchasing.supplier")} body={(r: SupplierInvoiceSummary) => localizedName({ name: r.supplierName, nameAr: r.supplierNameAr }, i18n.language)} />
            <Column header={t("purchasing.invoices.invoiceDate")} style={{ width: "9rem" }} body={(r: SupplierInvoiceSummary) => formatCalendarDate(r.invoiceDate, i18n.language)} />
            <Column header={t("purchasing.invoices.dueDate")} style={{ width: "9rem" }} body={(r: SupplierInvoiceSummary) => (r.dueDate ? formatCalendarDate(r.dueDate, i18n.language) : "")} />
            <Column header={t("purchasing.invoices.net")} align="right" body={(r: SupplierInvoiceSummary) => formatMoney(r.totalNet, r.currency)} />
            <Column header={t("purchasing.invoices.tax")} align="right" body={(r: SupplierInvoiceSummary) => formatMoney(r.totalTax, r.currency)} />
            <Column header={t("purchasing.invoices.gross")} align="right" body={(r: SupplierInvoiceSummary) => <strong>{formatMoney(r.totalGross, r.currency)}</strong>} />
            <Column
              header=""
              style={{ width: "8rem" }}
              body={(r: SupplierInvoiceSummary) => (
                <div style={{ display: "flex", gap: "0.25rem" }}>
                  <AttachmentsButton ownerType="SUPPLIER_INVOICE" ownerId={r.id} label={r.number} />
                </div>
              )}
            />
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

type ReturnLineRow = SupplierInvoiceLineDetail & {
  included: boolean;
  returnQty: string;
  taxCodeId: string;
  accountId: string;
};

export function PurchaseReturnDialog({ invoice, visible, onHide }: { invoice: SupplierInvoiceSummary; visible: boolean; onHide: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: detail, isError: loadError, refetch } = useSupplierInvoice(invoice.id);
  const { data: warehouses } = useAllWarehouses();
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [submissionKey, setSubmissionKey] = useState(newId);
  const create = useCreateDebitNote(invoice.id, submissionKey);
  const [date, setDate] = useState<Date>(new Date());
  const [rows, setRows] = useState<ReturnLineRow[]>([]);

  useEffect(() => {
    if (!visible || !detail?.lines) return;
    create.reset();
    setDate(new Date());
    setNotes("");
    setSubmissionKey(newId());
    setRows(
      detail.lines.map((l) => ({
        ...l,
        included: positiveReturnQuantity(l.returnableQuantity),
        returnQty: l.returnableQuantity,
        accountId: "",
      })),
    );
  }, [visible, detail?.lines]);

  const updateRow = (idx: number, patch: Partial<ReturnLineRow>) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const selectedRows = rows.filter((r) => r.included);
  const valid = selectedRows.length > 0 && selectedRows.every((r) => validReturnQuantity(r.returnQty, r.returnableQuantity))
    && (!selectedRows.some((r) => r.kind === "PO_LINE") || warehouseId !== "") && !create.isPending;

  const handlePost = () => {
    if (!valid) return;
    create.mutate(
      {
        debitDate: toDateOnlyIsoString(date),
        notes,
        lines: selectedRows.map((r) => ({
          originalLineId: r.id,
          ...(r.kind === "PO_LINE" ? { warehouseId } : {}),
          description:
            r.kind === "PO_LINE"
              ? localizedName({ name: r.itemName ?? "", nameAr: r.itemNameAr }, i18n.language)
              : r.description ?? localizedName({ name: r.accountName ?? "", nameAr: r.accountNameAr }, i18n.language),
          quantity: r.returnQty,
          unitPrice: r.unitPrice,
          taxCodeId: r.taxCodeId,
          accountId: r.accountId,
        })),
      },
      { onSuccess: (result) => { onHide(); void navigate(`/purchasing/invoices/${result.id}`); } },
    );
  };

  return (
    <Dialog header={t("purchasing.invoices.purchaseReturn")} visible={visible} onHide={onHide} className="erp-dialog erp-dialog--wide" modal style={{ width: "min(72rem, 96vw)" }}>
      {loadError ? <div role="alert"><p>{t("status.error")}</p><Button label={t("actions.retry")} onClick={() => void refetch()} /></div> : !detail ? (
        <PageSkeleton />
      ) : (
        <div className="erp-form">
          <p className="erp-field__hint">{t("purchasing.invoices.purchaseReturnHint")}</p>
          <div className="erp-form__row">
            <div className="erp-field">
              <label htmlFor="prDate">{t("purchasing.invoices.debitDate")}</label>
              <Calendar inputId="prDate" value={date} onChange={(e) => e.value && setDate(e.value)} dateFormat="yy-mm-dd" />
            </div>
          </div>
          {rows.some((r) => r.kind === "PO_LINE") ? <div className="erp-field">
            <label htmlFor="prWarehouse">{t("purchasing.returns.warehouse")}</label>
            <Dropdown inputId="prWarehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.value as string)}
              options={(warehouses ?? []).map((w) => ({ label: localizedName(w, i18n.language), value: w.id }))} filter />
          </div> : null}
          <div className="erp-field"><label htmlFor="prNotes">{t("purchasing.returns.reason")}</label><InputText id="prNotes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></div>
          <DataTable value={rows} className="erp-table" size="small" showGridlines>
            <Column
              header=""
              style={{ width: "2.5rem" }}
              body={(_: ReturnLineRow, opt) => (
                <input
                  type="checkbox"
                  disabled={!positiveReturnQuantity(rows[opt.rowIndex]?.returnableQuantity ?? "0") || create.isPending}
                  aria-label={t("documents.item")}
                  checked={rows[opt.rowIndex]?.included ?? false}
                  onChange={(e) => updateRow(opt.rowIndex, { included: e.target.checked })}
                />
              )}
            />
            <Column
              header={t("documents.item")}
              body={(r: ReturnLineRow) =>
                r.kind === "PO_LINE" ? (
                  <span><span className="coa-code">{r.itemCode}</span> {localizedName({ name: r.itemName ?? "", nameAr: r.itemNameAr }, i18n.language)}</span>
                ) : (
                  <span><span className="coa-code">{r.accountCode}</span> {localizedName({ name: r.accountName ?? "", nameAr: r.accountNameAr }, i18n.language)}{r.description ? ` — ${r.description}` : ""}</span>
                )
              }
            />
            <Column header={t("returns.remaining")} align="right" body={(r: ReturnLineRow) => r.returnableQuantity} />
            <Column header={t("purchasing.invoices.origQty")} align="right" style={{ width: "6rem" }} body={(r: ReturnLineRow) => r.quantity} />
            <Column
              header={t("purchasing.invoices.returnQty")}
              style={{ width: "8rem" }}
              body={(r: ReturnLineRow, opt) => (
                <InputText
                  disabled={!rows[opt.rowIndex]?.included}
                  dir="ltr"
                  value={rows[opt.rowIndex]?.returnQty ?? ""}
                  style={{ width: "100%" }}
                  onChange={(e) => updateRow(opt.rowIndex, { returnQty: e.target.value })}
                  className={rows[opt.rowIndex]?.included && !validReturnQuantity(rows[opt.rowIndex]?.returnQty ?? "", r.returnableQuantity) ? "p-invalid" : ""}
                />
              )}
            />
            <Column header={t("purchasing.unitPrice")} align="right" style={{ width: "9rem" }} body={(r: ReturnLineRow) => formatMoney(r.unitPrice, invoice.currency)} />
            <Column header={t("purchasing.invoices.taxCode")} body={(r: ReturnLineRow) => `${r.taxCode} (${r.taxRate}%)`} />
          </DataTable>
          {create.isError ? <p role="alert" className="erp-auth-card__error">{t("returns.errors." + ((create.error as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code ?? "generic"), { defaultValue: t("returns.errors.generic") })}</p> : null}
          <div className="erp-form__actions">
            <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
            <Button type="button" label={t("purchasing.invoices.postDebitNote")} disabled={!valid} loading={create.isPending} onClick={handlePost} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
