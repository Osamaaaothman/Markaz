import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
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
import { useCreateDebitNote, useSupplierInvoices, useTaxCodes, type SupplierInvoiceSummary } from "./use-invoicing";
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
          <DataGrid value={invoices} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
            <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(r: SupplierInvoiceSummary) => <span className="coa-code">{r.number}</span>} />
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

      {debitNoteFor ? <DebitNoteDialog invoice={debitNoteFor} visible={true} onHide={() => setDebitNoteFor(null)} /> : null}
    </div>
  );
}

function DebitNoteDialog({ invoice, visible, onHide }: { invoice: SupplierInvoiceSummary; visible: boolean; onHide: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data: taxCodes } = useTaxCodes(false);
  const { data: accounts } = useChartOfAccounts();
  const postable = (accounts ?? []).filter((a) => a.isPostable);
  const create = useCreateDebitNote(invoice.id);
  const [date, setDate] = useState<Date>(new Date());
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [accountId, setAccountId] = useState("");

  useEffect(() => {
    if (!visible) return;
    create.reset();
    setDate(new Date());
    setDescription("");
    setQuantity("1");
    setUnitPrice("");
    setTaxCodeId((taxCodes?.find((c) => c.treatment === "STANDARD") ?? taxCodes?.[0])?.id ?? "");
    setAccountId("");
    // Reset each time the dialog opens.
  }, [visible]);

  const valid = description.trim() !== "" && DECIMAL.test(quantity) && /[1-9]/.test(quantity) && DECIMAL.test(unitPrice) && taxCodeId !== "" && accountId !== "";
  const code = (create.error as { response?: { data?: { error?: { code?: string } } } } | null)?.response?.data?.error?.code;

  return (
    <Dialog header={t("purchasing.invoices.debitNote")} visible={visible} onHide={onHide} className="erp-dialog" modal style={{ width: "min(40rem, 96vw)" }}>
      <div className="erp-form">
        <p className="erp-field__hint">{t("purchasing.invoices.debitNoteHint")}</p>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="dnDate">{t("purchasing.invoices.debitDate")}</label>
            <Calendar inputId="dnDate" value={date} onChange={(e) => e.value && setDate(e.value)} dateFormat="yy-mm-dd" />
          </div>
        </div>
        <div className="erp-field">
          <label htmlFor="dnDesc">{t("sales.description")}</label>
          <InputText id="dnDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="dnQty">{t("purchasing.quantity")}</label>
            <InputText id="dnQty" dir="ltr" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="erp-field">
            <label htmlFor="dnPrice">{t("purchasing.unitPrice")}</label>
            <InputText id="dnPrice" dir="ltr" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
          </div>
          <div className="erp-field">
            <label htmlFor="dnTax">{t("purchasing.invoices.taxCode")}</label>
            <Dropdown inputId="dnTax" value={taxCodeId || null} onChange={(e) => setTaxCodeId((e.value as string | null) ?? "")} options={(taxCodes ?? []).map((c) => ({ label: c.code, value: c.id }))} />
          </div>
        </div>
        <div className="erp-field">
          <label htmlFor="dnAccount">{t("purchasing.invoices.expenseAccount")}</label>
          <Dropdown
            inputId="dnAccount"
            value={accountId || null}
            onChange={(e) => setAccountId((e.value as string | null) ?? "")}
            options={postable.map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id }))}
            filter
          />
        </div>
        {create.isError ? <p className="erp-auth-card__error">{code === "DEBIT_EXCEEDS_INVOICE" ? t("purchasing.invoices.errors.DEBIT_EXCEEDS_INVOICE") : t("purchasing.invoices.errors.generic")}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
          <Button
            type="button"
            label={t("purchasing.invoices.postDebitNote")}
            disabled={!valid}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { debitDate: toDateOnlyIsoString(date), lines: [{ description: description.trim(), quantity, unitPrice, taxCodeId, accountId }] },
                { onSuccess: onHide },
              )
            }
          />
        </div>
      </div>
    </Dialog>
  );
}
