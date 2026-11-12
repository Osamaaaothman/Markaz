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
import { useChartOfAccounts } from "../accounting/use-chart-of-accounts";
import { useCreateDebitNote, useSupplierInvoice, useSupplierInvoices, useTaxCodes, type SupplierInvoiceLineDetail, type SupplierInvoiceSummary } from "./use-invoicing";
import { AttachmentsButton } from "../attachments/AttachmentsButton";

const ALL = "ALL";
const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;

export function SupplierInvoicesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [type, setType] = useState<"INVOICE" | "DEBIT_NOTE" | null>(null);
  const [debitNoteFor, setDebitNoteFor] = useState<SupplierInvoiceSummary | null>(null);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useSupplierInvoices(type);
  const invoices = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("purchasing.invoices.title")}</h1>
          <p className="erp-page__subtitle">{t("purchasing.invoices.subtitle")}</p>
        </div>
        <PermissionButton allowed={can("supplier_invoice:create")} label={t("purchasing.invoices.new")} icon="pi pi-plus" onClick={() => void navigate("/purchasing/invoices/new")} />
      </div>

      <div className="coa-toolbar">
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
          <DataGrid emptyAction={{ allowed: can("supplier_invoice:create"), label: t("purchasing.invoices.new"), onClick: () => void navigate("/purchasing/invoices/new") }} value={invoices} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
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
                  {r.documentType === "INVOICE" ? (
                    <PermissionButton
                      allowed={can("debit_note:create")}
                      label=""
                      icon="pi pi-minus-circle"
                      rounded
                      text
                      severity="secondary"
                      aria-label={t("purchasing.invoices.debitNote")}
                      onClick={() => setDebitNoteFor(r)}
                    />
                  ) : null}
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

      {debitNoteFor ? <PurchaseReturnDialog invoice={debitNoteFor} visible={true} onHide={() => setDebitNoteFor(null)} /> : null}
    </div>
  );
}

type ReturnLineRow = SupplierInvoiceLineDetail & {
  included: boolean;
  returnQty: string;
  taxCodeId: string;
  accountId: string;
};

function PurchaseReturnDialog({ invoice, visible, onHide }: { invoice: SupplierInvoiceSummary; visible: boolean; onHide: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data: detail } = useSupplierInvoice(invoice.id);
  const { data: taxCodes } = useTaxCodes(false);
  const { data: accounts } = useChartOfAccounts();
  const postable = (accounts ?? []).filter((a) => a.isPostable);
  const create = useCreateDebitNote(invoice.id);
  const [date, setDate] = useState<Date>(new Date());
  const [rows, setRows] = useState<ReturnLineRow[]>([]);

  useEffect(() => {
    if (!visible || !detail?.lines || !taxCodes || !accounts) return;
    create.reset();
    setDate(new Date());
    setRows(
      detail.lines.map((l) => ({
        ...l,
        included: true,
        returnQty: l.quantity,
        taxCodeId: taxCodes.find((tc) => tc.code === l.taxCode)?.id ?? "",
        accountId: accounts.find((a) => a.code === l.accountCode)?.id ?? "",
      })),
    );
  }, [visible, detail?.lines, taxCodes, accounts]);

  const updateRow = (idx: number, patch: Partial<ReturnLineRow>) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const selectedRows = rows.filter((r) => r.included && DECIMAL.test(r.returnQty) && Number(r.returnQty) > 0 && Number(r.returnQty) <= Number(r.quantity) && r.taxCodeId !== "" && r.accountId !== "");
  const valid = selectedRows.length > 0;

  const handlePost = () => {
    create.mutate(
      {
        debitDate: toDateOnlyIsoString(date),
        lines: selectedRows.map((r) => ({
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
      { onSuccess: onHide },
    );
  };

  return (
    <Dialog header={t("purchasing.invoices.purchaseReturn")} visible={visible} onHide={onHide} className="erp-dialog erp-dialog--wide" modal style={{ width: "min(72rem, 96vw)" }}>
      {!detail ? (
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
          <DataTable value={rows} className="erp-table" size="small" showGridlines>
            <Column
              header=""
              style={{ width: "2.5rem" }}
              body={(_: ReturnLineRow, opt) => (
                <input
                  type="checkbox"
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
                  className={rows[opt.rowIndex]?.included && (!DECIMAL.test(rows[opt.rowIndex]?.returnQty ?? "") || Number(rows[opt.rowIndex]?.returnQty) > Number(r.quantity)) ? "p-invalid" : ""}
                />
              )}
            />
            <Column header={t("purchasing.unitPrice")} align="right" style={{ width: "9rem" }} body={(r: ReturnLineRow) => formatMoney(r.unitPrice, invoice.currency)} />
            <Column
              header={t("purchasing.invoices.taxCode")}
              style={{ width: "9rem" }}
              body={(_: ReturnLineRow, opt) => (
                <Dropdown
                  disabled={!rows[opt.rowIndex]?.included}
                  value={rows[opt.rowIndex]?.taxCodeId || null}
                  onChange={(e) => updateRow(opt.rowIndex, { taxCodeId: (e.value as string | null) ?? "" })}
                  options={(taxCodes ?? []).map((c) => ({ label: c.code, value: c.id }))}
                  style={{ width: "100%" }}
                />
              )}
            />
            <Column
              header={t("purchasing.invoices.expenseAccount")}
              body={(_: ReturnLineRow, opt) => (
                <Dropdown
                  disabled={!rows[opt.rowIndex]?.included}
                  value={rows[opt.rowIndex]?.accountId || null}
                  onChange={(e) => updateRow(opt.rowIndex, { accountId: (e.value as string | null) ?? "" })}
                  options={postable.map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id }))}
                  filter
                  style={{ width: "100%" }}
                />
              )}
            />
          </DataTable>
          {create.isError ? <p className="erp-auth-card__error">{t("purchasing.invoices.errors.generic")}</p> : null}
          <div className="erp-form__actions">
            <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
            <Button type="button" label={t("purchasing.invoices.postDebitNote")} disabled={!valid} loading={create.isPending} onClick={handlePost} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
