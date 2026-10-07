import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataGrid } from "../../shared/ui/DataGrid";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useQuotation, useQuotationAction, useQuotations, type QuotationStatus, type QuotationSummary, type SalesLineView } from "./use-sales";

const ALL = "ALL";
const STATUSES: readonly QuotationStatus[] = ["OPEN", "CONVERTED", "REJECTED", "CANCELLED"];
const SEVERITY: Record<QuotationStatus, "info" | "success" | "danger" | "secondary"> = { OPEN: "info", CONVERTED: "success", REJECTED: "danger", CANCELLED: "secondary" };

export function QuotationsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [status, setStatus] = useState<QuotationStatus | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useQuotations(status);
  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("sales.quotations.title")}</h1>
          <p className="erp-page__subtitle">{t("sales.quotations.subtitle")}</p>
        </div>
        <PermissionButton allowed={can("quotation:create")} label={t("sales.quotations.new")} icon="pi pi-plus" onClick={() => void navigate("/sales/quotations/new")} />
      </div>

      <div className="coa-toolbar">
        <div className="coa-levels">
          <span className="coa-levels__label">{t("purchasing.status")}</span>
          <Dropdown
            value={status ?? ALL}
            onChange={(e) => setStatus(e.value === ALL ? null : (e.value as QuotationStatus))}
            options={[{ label: t("purchasing.allStatuses"), value: ALL }, ...STATUSES.map((s) => ({ label: t(`sales.quotations.status.${s}`), value: s }))]}
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
          <DataGrid value={rows} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")} selectionMode="single" onRowClick={(e) => setViewId((e.data as QuotationSummary).id)}>
            <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(r: QuotationSummary) => <span className="coa-code">{r.number}</span>} />
            <Column header={t("sales.customer")} body={(r: QuotationSummary) => localizedName({ name: r.customerName, nameAr: r.customerNameAr }, i18n.language)} />
            <Column header={t("sales.quotations.date")} style={{ width: "9rem" }} body={(r: QuotationSummary) => formatCalendarDate(r.quotationDate, i18n.language)} />
            <Column header={t("sales.quotations.validUntil")} style={{ width: "9rem" }} body={(r: QuotationSummary) => (r.validUntil ? formatCalendarDate(r.validUntil, i18n.language) : "")} />
            <Column header={t("purchasing.invoices.gross")} align="right" style={{ width: "11rem" }} body={(r: QuotationSummary) => formatMoney(r.totalGross, r.currency)} />
            <Column header={t("purchasing.status")} style={{ width: "10rem" }} body={(r: QuotationSummary) => <Tag value={t(`sales.quotations.status.${r.status}`)} severity={SEVERITY[r.status]} />} />
          </DataGrid>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}

      <QuotationDialog id={viewId} onHide={() => setViewId(null)} />
    </div>
  );
}

function QuotationDialog({ id, onHide }: { id: string | null; onHide: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { data } = useQuotation(id);
  const convert = useQuotationAction(id ?? "", "convert");
  const reject = useQuotationAction(id ?? "", "reject");
  const cancel = useQuotationAction(id ?? "", "cancel");

  return (
    <Dialog header={data?.number ?? t("sales.quotations.title")} visible={id !== null} onHide={onHide} className="erp-dialog" modal style={{ width: "min(48rem, 96vw)" }}>
      {!data ? (
        <PageSkeleton />
      ) : (
        <>
          <p>{localizedName({ name: data.customerName, nameAr: data.customerNameAr }, i18n.language)}</p>
          {data.notes ? <p>{data.notes}</p> : null}
          <DataGrid value={[...data.lines]} className="erp-table" size="small" showGridlines>
            <Column header={t("sales.description")} body={(l: SalesLineView) => l.description} />
            <Column header={t("purchasing.quantity")} align="right" body={(l: SalesLineView) => l.quantity} />
            <Column header={t("purchasing.unitPrice")} align="right" body={(l: SalesLineView) => formatMoney(l.unitPrice, data.currency)} />
            <Column header={t("purchasing.invoices.net")} align="right" body={(l: SalesLineView) => formatMoney(l.netAmount, data.currency)} />
            <Column header={t("purchasing.invoices.tax")} align="right" body={(l: SalesLineView) => formatMoney(l.taxAmount, data.currency)} />
          </DataGrid>
          <div className="erp-table-footer">
            <span>
              {t("purchasing.invoices.gross")}: <strong>{formatMoney(data.totalGross, data.currency)}</strong>
            </span>
          </div>
          {convert.isError || reject.isError || cancel.isError ? <p className="erp-auth-card__error">{t("sales.errors.generic")}</p> : null}
          {data.status === "OPEN" ? (
            <div className="erp-form__actions">
              <PermissionButton allowed={can("quotation:update")} label={t("sales.quotations.reject")} severity="danger" outlined loading={reject.isPending} onClick={() => reject.mutate(undefined, { onSuccess: onHide })} />
              <PermissionButton allowed={can("quotation:update")} label={t("sales.quotations.cancel")} severity="secondary" outlined loading={cancel.isPending} onClick={() => cancel.mutate(undefined, { onSuccess: onHide })} />
              <PermissionButton
                allowed={can("sales_order:create")}
                label={t("sales.quotations.convert")}
                icon="pi pi-arrow-right"
                loading={convert.isPending}
                onClick={() => convert.mutate(undefined, { onSuccess: (created) => void navigate(`/sales/orders/${created.id}`) })}
              />
            </div>
          ) : data.salesOrderId ? (
            <div className="erp-form__actions">
              <Button label={t("sales.quotations.openOrder")} text onClick={() => void navigate(`/sales/orders/${data.salesOrderId}`)} />
            </div>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
