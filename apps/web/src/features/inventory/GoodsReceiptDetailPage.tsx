import { DocumentTrail } from "../documents/DocumentTrail";
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
import { exportReport } from "../accounting/export-report";
import { tafqeetAmount } from "@erp/shared";
import { useGoodsReceipt, type GoodsReceiptLineDetail } from "./use-goods-receipts";

// One goods receipt as posted: which warehouse took the stock, from whom, at what cost, and the entry it made.
export function GoodsReceiptDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: receipt, isPending, isError, refetch } = useGoodsReceipt(id);

  if (isPending) return <PageSkeleton />;
  if (isError || !receipt) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }
  const money = (v: string): string => formatMoney(v, receipt.currency);

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{receipt.number}</h1>
          <p className="erp-page__subtitle">{localizedName({ name: receipt.warehouseName, nameAr: receipt.warehouseNameAr }, i18n.language)}</p>
        </div>
        <div className="erp-page__header-actions">
          <JournalEntryLinkButton entryId={receipt.journalEntryId} />
          <Button label={t("actions.exportPdf")} icon="pi pi-file-pdf" outlined onClick={() => void exportReport(`/v1/goods-receipts/${receipt.id}/pdf`, { lang: i18n.language }, receipt.number, "pdf")} />
          <Button label={t("actions.print")} icon="pi pi-print" outlined onClick={() => void exportReport(`/v1/goods-receipts/${receipt.id}/pdf`, { lang: i18n.language }, receipt.number, "print")} />
        </div>
      </div>

      <dl className="mk-facts">
        <div>
          <dt>{t("inventory.goodsReceipt.documentDate")}</dt>
          <dd>{formatCalendarDate(receipt.documentDate, i18n.language)}</dd>
        </div>
        <div>
          <dt>{t("purchasing.supplier")}</dt>
          <dd>{receipt.partyName ? localizedName({ name: receipt.partyName, nameAr: receipt.partyNameAr }, i18n.language) : "—"}</dd>
        </div>
        {receipt.purchaseOrderId ? (
          <div>
            <dt>{t("documents.purchaseOrder")}</dt>
            <dd>
              <button type="button" className="erp-button-link" onClick={() => void navigate(`/purchasing/orders/${receipt.purchaseOrderId}`)}>
                {receipt.purchaseOrderNumber}
              </button>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{t("created.reference")}</dt>
          <dd dir="ltr">{receipt.reference ?? "—"}</dd>
        </div>
        <div>
          <dt>{t("documents.totalValue")}</dt>
          <dd dir="ltr"><strong>{money(receipt.totalValue)}</strong></dd>
        </div>
        <div>
          <dt>{t("created.inWords")}</dt>
          <dd><strong>{tafqeetAmount(receipt.totalValue, receipt.currency)}</strong></dd>
        </div>
      </dl>

      <h3 className="erp-form__section-title">{t("purchasing.lines")}</h3>
      <DataTable value={[...receipt.lines]} className="erp-table" stripedRows showGridlines size="small">
        <Column header={t("inventory.items.code")} style={{ width: "8rem" }} body={(l: GoodsReceiptLineDetail) => <span className="coa-code">{l.itemCode}</span>} />
        <Column header={t("inventory.items.displayName")} body={(l: GoodsReceiptLineDetail) => localizedName({ name: l.itemName, nameAr: l.itemNameAr }, i18n.language)} />
        <Column header={t("purchasing.quantity")} align="right" body={(l: GoodsReceiptLineDetail) => `${Number(l.quantity)} ${l.unit}`} />
        <Column header={t("documents.unitCost")} align="right" body={(l: GoodsReceiptLineDetail) => money(l.unitCost)} />
        <Column header={t("created.total")} align="right" body={(l: GoodsReceiptLineDetail) => money(l.value)} />
      </DataTable>

      <div className="erp-form__actions">
        <Button type="button" label={t("documents.backToList")} text onClick={() => void navigate("/inventory/goods-receipts")} />
      </div>
    <DocumentTrail kind="goods_receipt" id={id} />
    </div>
  );
}
