import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { AuditEntryDialog } from "../audit/AuditEntryDialog";
import { useAuditPresentation } from "../audit/audit-presentation";
import { useAuditLog, type AuditLogEntry } from "../audit/use-audit-log";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";

export const DOCUMENT_AUDIT_ENTITIES: Readonly<Record<string, string>> = {
  sales_invoice: "SalesInvoice",
  supplier_invoice: "SupplierInvoice",
  payment: "Payment",
  quotation: "Quotation",
  sales_order: "SalesOrder",
  purchase_order: "PurchaseOrder",
  purchase_request: "PurchaseRequest",
  goods_receipt: "GoodsReceipt",
  stock_issue: "StockIssue",
  goods_return: "GoodsReturn",
  journal_entry: "JournalEntry",
  stock_count: "StockCount",
  hr_payment: "HrPayment",
  payroll_run: "PayrollRun",
  cash_expense: "CashExpense",
};

export function DocumentActivity({
  entityType,
  id,
}: {
  entityType: string;
  id: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<AuditLogEntry | null>(null);
  const { when, actionName } = useAuditPresentation();
  const result = useAuditLog({
    entityType,
    entityId: id,
    action: "",
    actorId: "",
    from: "",
    to: "",
  });
  const rows = result.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <section className="mk-document-activity" aria-label={t("trail.activity")}>
      <div className="mk-document-section-header">
        <p className="erp-field__hint">{t("trail.activityHint")}</p>
        <Button
          label={t("audit.refresh")}
          icon="pi pi-refresh"
          text
          onClick={() => void result.refetch()}
          loading={result.isFetching}
        />
      </div>
      {result.isPending ? (
        <PageSkeleton />
      ) : result.isError ? (
        <div role="alert">
          <p>{t("status.error")}</p>
          <Button label={t("actions.retry")} onClick={() => void result.refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={t("trail.noActivity")} hint={t("audit.snapshotNotice")} />
      ) : (
        <ol className="mk-event-timeline">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="mk-event-timeline__marker">
                <i
                  className={`pi ${row.action.includes("void") ? "pi-ban" : row.action.includes("updated") ? "pi-pencil" : "pi-check"}`}
                  aria-hidden="true"
                />
              </span>
              <div className="mk-event-timeline__body">
                <button type="button" className="erp-button-link" onClick={() => setEntry(row)}>
                  {actionName(row.action)}
                </button>
                <p>
                  <bdi>{row.actorEmail ?? row.actorId}</bdi>
                  <span aria-hidden="true"> · </span>
                  <time dir="ltr" dateTime={row.createdAt}>
                    {when(row.createdAt)}
                  </time>
                </p>
                <Button
                  label={t("audit.details")}
                  icon="pi pi-eye"
                  text
                  size="small"
                  onClick={() => setEntry(row)}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
      {result.hasNextPage ? (
        <Button
          label={t("actions.loadMore")}
          text
          loading={result.isFetchingNextPage}
          onClick={() => void result.fetchNextPage()}
        />
      ) : null}
      <AuditEntryDialog
        key={entry?.id ?? "closed"}
        entry={entry}
        onHide={() => setEntry(null)}
        onHistory={(row) =>
          void navigate(
            `/settings/audit-log?${new URLSearchParams({ entityType: row.entityType, entityId: row.entityId })}`,
          )
        }
      />
    </section>
  );
}
