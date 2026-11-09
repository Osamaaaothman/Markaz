import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { DataGrid } from "../../shared/ui/DataGrid";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useAuditFilters, useAuditLog, type AuditFilter, type AuditLogEntry } from "./use-audit-log";

const EMPTY: AuditFilter = { entityType: "", action: "", actorId: "", from: "", to: "" };
const ALL = "__all__";

// Who changed what, and when. Read-only: the log is append-only and cannot be edited or deleted from anywhere.
export function AuditLogPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<AuditFilter>(EMPTY);
  const [open, setOpen] = useState<AuditLogEntry | null>(null);
  const { data: filters } = useAuditFilters();
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useAuditLog(filter);
  const rows = data?.pages.flatMap((p) => p.data) ?? [];
  // Always "2026-11-03 18:00:32" (the viewer's own time zone): one unambiguous shape in both languages, with no mixed-direction digits.
  const when = (iso: string): string => {
    const d = new Date(iso);
    const p = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const set = (patch: Partial<AuditFilter>): void => setFilter({ ...filter, ...patch });

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("audit.title")}</h1>
          <p className="erp-page__subtitle">{t("audit.subtitle")}</p>
        </div>
      </div>

      <div className="coa-toolbar">
        <div className="coa-levels">
          <span className="coa-levels__label">{t("audit.entityType")}</span>
          <Dropdown value={filter.entityType || ALL} onChange={(e) => set({ entityType: e.value === ALL ? "" : (e.value as string) })} options={[{ label: t("audit.all"), value: ALL }, ...(filters?.entityTypes ?? []).map((v) => ({ label: v, value: v }))]} filter />
        </div>
        <div className="coa-levels">
          <span className="coa-levels__label">{t("audit.user")}</span>
          <Dropdown value={filter.actorId || ALL} onChange={(e) => set({ actorId: e.value === ALL ? "" : (e.value as string) })} options={[{ label: t("audit.all"), value: ALL }, ...(filters?.users ?? []).map((u) => ({ label: u.email, value: u.id }))]} filter />
        </div>
        <div className="coa-search">
          <InputText value={filter.action} onChange={(e) => set({ action: e.target.value })} placeholder={t("audit.actionPlaceholder")} aria-label={t("audit.action")} dir="ltr" />
        </div>
        <InputText type="date" value={filter.from} onChange={(e) => set({ from: e.target.value })} aria-label={t("audit.from")} />
        <InputText type="date" value={filter.to} onChange={(e) => set({ to: e.target.value })} aria-label={t("audit.to")} />
        <Button type="button" label={t("audit.clear")} text onClick={() => setFilter(EMPTY)} />
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
          <DataGrid value={rows} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")} selectionMode="single" onRowClick={(e) => setOpen(e.data as AuditLogEntry)}>
            <Column header={t("audit.when")} style={{ width: "13rem" }} body={(r: AuditLogEntry) => <span dir="ltr">{when(r.createdAt)}</span>} />
            <Column header={t("audit.user")} style={{ width: "15rem" }} body={(r: AuditLogEntry) => <span dir="ltr">{r.actorEmail ?? r.actorId}</span>} />
            <Column header={t("audit.action")} body={(r: AuditLogEntry) => <span className="coa-code" dir="ltr">{r.action}</span>} />
            <Column header={t("audit.entityType")} style={{ width: "10rem" }} body={(r: AuditLogEntry) => <span dir="ltr">{r.entityType}</span>} />
            <Column header={t("audit.entityId")} style={{ width: "13rem" }} body={(r: AuditLogEntry) => <span className="coa-code" dir="ltr">{r.entityId.length > 14 ? `${r.entityId.slice(0, 8)}…` : r.entityId}</span>} />
          </DataGrid>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}

      <Dialog header={open?.action ?? ""} visible={open !== null} onHide={() => setOpen(null)} className="erp-dialog erp-dialog--wide" modal style={{ width: "min(60rem, 96vw)" }}>
        {open ? (
          <div className="erp-form">
            <dl className="mk-facts">
              <div>
                <dt>{t("audit.when")}</dt>
                <dd dir="ltr">{when(open.createdAt)}</dd>
              </div>
              <div>
                <dt>{t("audit.user")}</dt>
                <dd dir="ltr">{open.actorEmail ?? open.actorId}</dd>
              </div>
              <div>
                <dt>{t("audit.entityType")}</dt>
                <dd dir="ltr">{open.entityType}</dd>
              </div>
              <div>
                <dt>{t("audit.entityId")}</dt>
                <dd dir="ltr">{open.entityId}</dd>
              </div>
              <div>
                <dt>{t("audit.correlation")}</dt>
                <dd dir="ltr">{open.correlationId}</dd>
              </div>
            </dl>
            {open.before !== null ? (
              <>
                <h3 className="erp-form__section-title">{t("audit.before")}</h3>
                <pre className="mk-json" dir="ltr">{JSON.stringify(open.before, null, 2)}</pre>
              </>
            ) : null}
            {open.after !== null ? (
              <>
                <h3 className="erp-form__section-title">{t("audit.after")}</h3>
                <pre className="mk-json" dir="ltr">{JSON.stringify(open.after, null, 2)}</pre>
              </>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
