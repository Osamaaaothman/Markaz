import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { JournalEntryLinkButton } from "../accounting/JournalEntryLinkButton";
import { useGoodsReturn, type GoodsReturnLine } from "./use-goods-returns";
import { exportReport } from "../accounting/export-report";

// One return of goods to a supplier: which order it came from, what left stock and at what cost.
export function GoodsReturnDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: ret, isPending, isError, refetch } = useGoodsReturn(id);

  if (isPending) return <PageSkeleton />;
  if (isError || !ret) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }
  const money = (v: string): string => formatMoney(v, ret.currency);

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{ret.number}</h1>
          <p className="erp-page__subtitle">{localizedName({ name: ret.supplierName, nameAr: ret.supplierNameAr }, i18n.language)}</p>
        </div>
        <div className="erp-page__header-actions">
          <JournalEntryLinkButton entryId={ret.journalEntryId} />
          <Button label={t("actions.exportPdf")} icon="pi pi-file-pdf" outlined onClick={() => void exportReport(`/v1/goods-returns/${ret.id}/pdf`, { lang: i18n.language }, ret.number, "pdf")} />
          <Button label={t("actions.print")} icon="pi pi-print" outlined onClick={() => void exportReport(`/v1/goods-returns/${ret.id}/pdf`, { lang: i18n.language }, ret.number, "print")} />
        </div>
      </div>

      <dl className="mk-facts">
        <div>
          <dt>{t("purchasing.date")}</dt>
          <dd>{formatCalendarDate(ret.documentDate, i18n.language)}</dd>
        </div>
        <div>
          <dt>{t("documents.purchaseOrder")}</dt>
          <dd>
            <button type="button" className="erp-button-link" onClick={() => void navigate(`/purchasing/orders/${ret.purchaseOrderId}`)}>
              {ret.purchaseOrderNumber}
            </button>
          </dd>
        </div>
        <div>
          <dt>{t("created.warehouse")}</dt>
          <dd>{localizedName({ name: ret.warehouseName, nameAr: ret.warehouseNameAr }, i18n.language)}</dd>
        </div>
        <div>
          <dt>{t("created.reference")}</dt>
          <dd dir="ltr">{ret.reference ?? "—"}</dd>
        </div>
        <div>
          <dt>{t("documents.totalValue")}</dt>
          <dd dir="ltr"><strong>{money(ret.totalValue)}</strong></dd>
        </div>
      </dl>
      {ret.reason ? <p>{ret.reason}</p> : null}

      <h3 className="erp-form__section-title">{t("purchasing.lines")}</h3>
      <DataTable value={[...ret.lines]} className="erp-table" stripedRows showGridlines size="small">
        <Column header={t("inventory.items.code")} style={{ width: "8rem" }} body={(l: GoodsReturnLine) => <span className="coa-code">{l.itemCode}</span>} />
        <Column header={t("inventory.items.displayName")} body={(l: GoodsReturnLine) => localizedName({ name: l.itemName, nameAr: l.itemNameAr }, i18n.language)} />
        <Column header={t("purchasing.quantity")} align="right" body={(l: GoodsReturnLine) => l.quantity} />
        <Column header={t("documents.unitCost")} align="right" body={(l: GoodsReturnLine) => money(l.unitCost)} />
        <Column header={t("created.total")} align="right" body={(l: GoodsReturnLine) => money(l.value)} />
      </DataTable>

      <div className="erp-form__actions">
        <Button type="button" label={t("documents.backToList")} text onClick={() => void navigate("/purchasing/returns")} />
      </div>
    </div>
  );
}
