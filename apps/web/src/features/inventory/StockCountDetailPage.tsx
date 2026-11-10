import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { JournalEntryLinkButton } from "../accounting/JournalEntryLinkButton";
import { exportReport } from "../accounting/export-report";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { usePostStockCount, useStockCount, type StockCountLineDetail } from "./use-stock-counts";

// One physical count: what was counted against what the books said. A draft can be posted from here; a posted count links to its entry.
export function StockCountDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: count, isPending, isError, refetch } = useStockCount(id);
  const post = usePostStockCount();

  if (isPending) return <PageSkeleton />;
  if (isError || !count) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }
  const signed = (v: string): string => (Number(v) > 0 ? `+${Number(v)}` : String(Number(v)));

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{count.number}</h1>
          <p className="erp-page__subtitle">{localizedName({ name: count.warehouseName, nameAr: count.warehouseNameAr }, i18n.language)}</p>
        </div>
        <div className="erp-page__header-actions">
          <Tag value={count.isPosted ? t("inventory.stockCount.posted") : t("inventory.stockCount.draft")} severity={count.isPosted ? "success" : "warning"} />
          {count.journalEntryId ? <JournalEntryLinkButton entryId={count.journalEntryId} /> : null}
          <Button label={t("actions.exportPdf")} icon="pi pi-file-pdf" outlined onClick={() => void exportReport(`/v1/stock-counts/${count.id}/pdf`, { lang: i18n.language }, count.number, "pdf")} />
          <Button label={t("actions.print")} icon="pi pi-print" outlined onClick={() => void exportReport(`/v1/stock-counts/${count.id}/pdf`, { lang: i18n.language }, count.number, "print")} />
          {count.isPosted ? null : (
            <PermissionButton allowed={can("stock_count:post")} label={t("inventory.stockCount.post")} icon="pi pi-check" loading={post.isPending} onClick={() => post.mutate(count.id, { onSuccess: () => void refetch() })} />
          )}
        </div>
      </div>

      <dl className="mk-facts">
        <div>
          <dt>{t("inventory.goodsReceipt.documentDate")}</dt>
          <dd>{formatCalendarDate(count.documentDate, i18n.language)}</dd>
        </div>
        <div>
          <dt>{t("inventory.stockCount.lineCount")}</dt>
          <dd>{count.lineCount}</dd>
        </div>
        {count.postedAt ? (
          <div>
            <dt>{t("documents.postedAt")}</dt>
            <dd>{formatCalendarDate(count.postedAt, i18n.language)}</dd>
          </div>
        ) : null}
      </dl>
      {count.isPosted && !count.journalEntryId ? <p className="erp-field__hint">{t("documents.countNoVariance")}</p> : null}
      {post.isError ? <p className="erp-auth-card__error">{t("documents.countPostError")}</p> : null}

      <h3 className="erp-form__section-title">{t("purchasing.lines")}</h3>
      <DataTable value={[...count.lines]} className="erp-table" stripedRows showGridlines size="small">
        <Column header={t("inventory.items.code")} style={{ width: "8rem" }} body={(l: StockCountLineDetail) => <span className="coa-code">{l.itemCode}</span>} />
        <Column header={t("inventory.items.displayName")} body={(l: StockCountLineDetail) => localizedName({ name: l.itemName, nameAr: l.itemNameAr }, i18n.language)} />
        <Column header={t("documents.systemQuantity")} align="right" body={(l: StockCountLineDetail) => `${Number(l.systemQuantity)} ${l.unit}`} />
        <Column header={t("documents.countedQuantity")} align="right" body={(l: StockCountLineDetail) => `${Number(l.countedQuantity)} ${l.unit}`} />
        <Column header={t("documents.difference")} align="right" body={(l: StockCountLineDetail) => <span dir="ltr">{signed(l.difference)}</span>} />
        <Column header={t("documents.unitCost")} align="right" body={(l: StockCountLineDetail) => formatMoney(l.unitCost, currency)} />
      </DataTable>

      <div className="erp-form__actions">
        <Button type="button" label={t("documents.backToList")} text onClick={() => void navigate("/inventory/stock-counts")} />
      </div>
    </div>
  );
}
