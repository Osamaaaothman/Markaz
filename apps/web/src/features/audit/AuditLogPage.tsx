import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AuditEntryDialog } from "./AuditEntryDialog";
import { useAuditPresentation } from "./audit-presentation";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { DataGrid } from "../../shared/ui/DataGrid";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { auditSeverity } from "./audit-details";
import {
  useAuditFilters,
  useAuditLog,
  type AuditFilter,
  type AuditLogEntry,
} from "./use-audit-log";
import "./audit.css";

const EMPTY: AuditFilter = {
  entityType: "",
  entityId: "",
  action: "",
  actorId: "",
  from: "",
  to: "",
};
const ALL = "__all__";

export function AuditLogPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<AuditFilter>({
    ...EMPTY,
    entityType: params.get("entityType") ?? "",
    entityId: params.get("entityId") ?? "",
  });
  const [open, setOpen] = useState<AuditLogEntry | null>(null);
  const { data: filters } = useAuditFilters();
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAuditLog(filter);
  const rows = data?.pages.flatMap((p) => p.data) ?? [];
  const { when, entityName, actionName, number } = useAuditPresentation();
  const view = (row: AuditLogEntry): void => {
    setOpen(row);
  };
  const set = (patch: Partial<AuditFilter>): void =>
    setFilter((previous) => ({ ...previous, ...patch }));

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("audit.title")}</h1>
          <p className="erp-page__subtitle">{t("audit.subtitle")}</p>
        </div>
        <Button
          text
          icon="pi pi-refresh"
          label={t("audit.refresh")}
          onClick={() => void refetch()}
        />
      </div>
      <div className="audit-filters">
        <label>
          {t("audit.entityType")}
          <Dropdown
            aria-label={t("audit.entityType")}
            value={filter.entityType || ALL}
            onChange={(e) =>
              set({ entityType: e.value === ALL ? "" : (e.value as string), entityId: "" })
            }
            options={[
              { label: t("audit.all"), value: ALL },
              ...(filters?.entityTypes ?? []).map((v) => ({ label: entityName(v), value: v })),
            ]}
            filter
          />
        </label>
        <label>
          {t("audit.user")}
          <Dropdown
            aria-label={t("audit.user")}
            value={filter.actorId || ALL}
            onChange={(e) => set({ actorId: e.value === ALL ? "" : (e.value as string) })}
            options={[
              { label: t("audit.all"), value: ALL },
              ...(filters?.users ?? []).map((u) => ({ label: u.email, value: u.id })),
            ]}
            filter
          />
        </label>
        <label>
          {t("audit.action")}
          <InputText
            value={filter.action}
            onChange={(e) => set({ action: e.target.value })}
            placeholder={t("audit.actionPlaceholder")}
            dir="ltr"
          />
        </label>
        <label>
          {t("audit.from")}
          <InputText
            type="date"
            value={filter.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </label>
        <label>
          {t("audit.to")}
          <InputText type="date" value={filter.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <Button label={t("audit.clear")} text onClick={() => setFilter(EMPTY)} />
      </div>
      {filter.entityId ? (
        <p className="audit-scope">
          {t("audit.documentHistoryFilter")} <bdi>{filter.entityId}</bdi>
          <Button text label={t("audit.clear")} onClick={() => set({ entityId: "" })} />
        </p>
      ) : null}
      <p className="audit-muted">{t("audit.searchHint")}</p>
      {isPending ? (
        <PageSkeleton />
      ) : isError ? (
        <div role="alert">
          <p className="erp-page__error">{t("status.error")}</p>
          <Button text label={t("actions.retry")} onClick={() => void refetch()} />
        </div>
      ) : (
        <>
          <DataGrid
            value={rows}
            stripedRows
            size="small"
            emptyMessage={t("status.empty")}
            selectionMode="single"
            onRowClick={(e) => view(e.data as AuditLogEntry)}
          >
            <Column
              header={t("audit.when")}
              body={(r: AuditLogEntry) => (
                <time dateTime={r.createdAt} dir="ltr">
                  {when(r.createdAt)}
                </time>
              )}
            />
            <Column
              header={t("audit.user")}
              body={(r: AuditLogEntry) => <bdi>{r.actorEmail ?? r.actorId}</bdi>}
            />
            <Column
              header={t("audit.action")}
              body={(r: AuditLogEntry) => (
                <Tag severity={auditSeverity(r.action)} value={actionName(r.action)} />
              )}
            />
            <Column
              header={t("audit.entityType")}
              body={(r: AuditLogEntry) => entityName(r.entityType)}
            />
            <Column header={t("audit.document")} body={number} />
            <Column
              header={t("audit.details")}
              body={(r: AuditLogEntry) => (
                <Button
                  text
                  icon="pi pi-eye"
                  label={t("audit.details")}
                  onClick={(e) => {
                    e.stopPropagation();
                    view(r);
                  }}
                />
              )}
            />
          </DataGrid>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button
                label={t("actions.loadMore")}
                text
                onClick={() => void fetchNextPage()}
                loading={isFetchingNextPage}
                icon="pi pi-chevron-down"
              />
            </div>
          ) : null}
        </>
      )}
      <AuditEntryDialog
        key={open?.id ?? "closed"}
        entry={open}
        onHide={() => setOpen(null)}
        onHistory={(entry) => {
          setFilter({ ...EMPTY, entityType: entry.entityType, entityId: entry.entityId });
          setOpen(null);
        }}
      />
    </div>
  );
}
