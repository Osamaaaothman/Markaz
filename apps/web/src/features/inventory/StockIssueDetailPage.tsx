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
import { useStockIssue, type StockIssueLineDetail } from "./use-stock-issues";

// One stock issue as posted: which warehouse it left, which cost centre it was charged to, at what cost, and the entry it made.
export function StockIssueDetailPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: issue, isPending, isError, refetch } = useStockIssue(id);

  if (isPending) return <PageSkeleton />;
  if (isError || !issue) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }
  const money = (v: string): string => formatMoney(v, issue.currency);

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{issue.number}</h1>
          <p className="erp-page__subtitle">{localizedName({ name: issue.warehouseName, nameAr: issue.warehouseNameAr }, i18n.language)}</p>
        </div>
        <div className="erp-page__header-actions">
          <JournalEntryLinkButton entryId={issue.journalEntryId} />
          <Button label={t("actions.exportPdf")} icon="pi pi-file-pdf" outlined onClick={() => void exportReport(`/v1/stock-issues/${issue.id}/pdf`, { lang: i18n.language }, issue.number, "pdf")} />
          <Button label={t("actions.print")} icon="pi pi-print" outlined onClick={() => void exportReport(`/v1/stock-issues/${issue.id}/pdf`, { lang: i18n.language }, issue.number, "print")} />
        </div>
      </div>

      <dl className="mk-facts">
        <div>
          <dt>{t("inventory.goodsReceipt.documentDate")}</dt>
          <dd>{formatCalendarDate(issue.documentDate, i18n.language)}</dd>
        </div>
        <div>
          <dt>{t("documents.costCenter")}</dt>
          <dd>{issue.costCenterRef}</dd>
        </div>
        <div>
          <dt>{t("documents.totalValue")}</dt>
          <dd dir="ltr"><strong>{money(issue.totalValue)}</strong></dd>
        </div>
      </dl>

      <h3 className="erp-form__section-title">{t("purchasing.lines")}</h3>
      <DataTable value={[...issue.lines]} className="erp-table" stripedRows showGridlines size="small">
        <Column header={t("inventory.items.code")} style={{ width: "8rem" }} body={(l: StockIssueLineDetail) => <span className="coa-code">{l.itemCode}</span>} />
        <Column header={t("inventory.items.displayName")} body={(l: StockIssueLineDetail) => localizedName({ name: l.itemName, nameAr: l.itemNameAr }, i18n.language)} />
        <Column header={t("purchasing.quantity")} align="right" body={(l: StockIssueLineDetail) => `${Number(l.quantity)} ${l.unit}`} />
        <Column header={t("documents.unitCost")} align="right" body={(l: StockIssueLineDetail) => money(l.unitCost)} />
        <Column header={t("created.total")} align="right" body={(l: StockIssueLineDetail) => money(l.value)} />
      </DataTable>

      <div className="erp-form__actions">
        <Button type="button" label={t("documents.backToList")} text onClick={() => void navigate("/inventory/stock-issues")} />
      </div>
    <DocumentTrail kind="stock_issue" id={id} />
    </div>
  );
}
