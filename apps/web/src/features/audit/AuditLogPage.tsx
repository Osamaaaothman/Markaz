import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { DataGrid } from "../../shared/ui/DataGrid";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { documentPath } from "../../shared/lib/document-path";
import { usePermissions } from "../../shared/auth/use-permissions";
import { auditFields, auditSeverity, recordedNumber } from "./audit-details";
import {
  useAuditFilters,
  useAuditLog,
  type AuditFilter,
  type AuditLogEntry,
  type AuditReference,
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
  const { can } = usePermissions();
  const [filter, setFilter] = useState<AuditFilter>(EMPTY);
  const [open, setOpen] = useState<AuditLogEntry | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const { data: filters } = useAuditFilters();
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAuditLog(filter);
  const rows = data?.pages.flatMap((p) => p.data) ?? [];
  const when = (iso: string): string => {
    const d = new Date(iso);
    const p = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const entityName = (type: string): string => t(`audit.entities.${type}`, { defaultValue: type });
  const actionName = (action: string): string => {
    const [subject, ...operation] = action.split(".");
    const verb = operation.join("_");
    return t("audit.operationLabel", {
      operation: t(`audit.operations.${verb}`, { defaultValue: verb.replaceAll("_", " ") }),
      entity: t(`audit.subjects.${subject}`, { defaultValue: subject?.replaceAll("_", " ") ?? "" }),
    });
  };
  const reference = (doc: AuditReference): React.JSX.Element => {
    const path = can(`${doc.kind}:read`) ? documentPath(doc.kind, doc.id) : null;
    return path ? (
      <Link
        className="audit-document-link"
        to={path}
        onClick={(e) => e.stopPropagation()}
        title={t("audit.openDocument")}
      >
        <bdi>{doc.number}</bdi>
        <i className="pi pi-external-link" aria-hidden="true" />
      </Link>
    ) : (
      <bdi>{doc.number}</bdi>
    );
  };
  const number = (row: AuditLogEntry): React.JSX.Element =>
    row.document ? (
      reference(row.document)
    ) : (
      <bdi>
        {recordedNumber(row.after) ?? recordedNumber(row.before) ?? t("audit.unavailableNumber")}
      </bdi>
    );
  const fieldName = (path: string[]): string =>
    path
      .map((key) =>
        /^\d+$/.test(key)
          ? t("audit.lineNumber", { number: Number(key) + 1 })
          : t(`audit.fields.${key}`, { defaultValue: key }),
      )
      .join(" / ");
  const value = (v: unknown): React.ReactNode => {
    if (v === undefined) return <span className="audit-muted">{t("audit.notRecorded")}</span>;
    if (v === null || v === "") return <span className="audit-muted">{t("audit.emptyValue")}</span>;
    if (typeof v === "boolean") return t(v ? "audit.yes" : "audit.no");
    const doc =
      open?.relatedDocuments?.find((d) => d.id === v) ??
      (open?.document?.id === v ? open.document : null);
    if (doc) return reference(doc);
    if (typeof v === "string") return <bdi>{t(`audit.values.${v}`, { defaultValue: v })}</bdi>;
    return <bdi>{typeof v === "number" ? String(v) : JSON.stringify(v)}</bdi>;
  };
  const fields = open ? auditFields(open.before, open.after) : [];
  const hasBoth = open?.before != null && open.after != null;
  const shown = fields.filter((f) => !hasBoth || !onlyChanged || f.changed);
  const view = (row: AuditLogEntry): void => {
    setOpen(row);
    setOnlyChanged(true);
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
      <Dialog
        header={open ? actionName(open.action) : ""}
        visible={open !== null}
        onHide={() => setOpen(null)}
        className="erp-dialog erp-dialog--wide"
        modal
        style={{ width: "80vw" }}
      >
        {open ? (
          <div className="erp-form audit-detail">
            <dl className="mk-facts">
              <div>
                <dt>{t("audit.document")}</dt>
                <dd>{number(open)}</dd>
              </div>
              <div>
                <dt>{t("audit.entityType")}</dt>
                <dd>{entityName(open.entityType)}</dd>
              </div>
              <div>
                <dt>{t("audit.when")}</dt>
                <dd>
                  <time dir="ltr" dateTime={open.createdAt}>
                    {when(open.createdAt)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>{t("audit.user")}</dt>
                <dd>
                  <bdi>{open.actorEmail ?? open.actorId}</bdi>
                </dd>
              </div>
            </dl>
            <Button
              text
              icon="pi pi-history"
              label={t("audit.documentHistory")}
              onClick={() => {
                setFilter({ ...EMPTY, entityType: open.entityType, entityId: open.entityId });
                setOpen(null);
              }}
            />
            {open.relatedDocuments?.length ? (
              <section>
                <h3 className="erp-form__section-title">{t("audit.related")}</h3>
                <ul className="audit-related">
                  {open.relatedDocuments.map((doc) => (
                    <li key={`${doc.kind}:${doc.id}`}>
                      <span>{entityName(doc.entityType)}</span>
                      {reference(doc)}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section>
              <div className="audit-section-header">
                <h3 className="erp-form__section-title">
                  {t(hasBoth ? "audit.changes" : "audit.recordedDetails")}
                </h3>
                {hasBoth ? (
                  <Button
                    text
                    label={t(onlyChanged ? "audit.showAll" : "audit.showChanged")}
                    onClick={() => setOnlyChanged(!onlyChanged)}
                  />
                ) : null}
              </div>
              <p className="audit-muted">{t("audit.snapshotNotice")}</p>
              {shown.length ? (
                <div className="audit-changes-wrapper">
                  <table className="audit-changes">
                    <thead>
                      <tr>
                        <th scope="col">{t("audit.field")}</th>
                        {open.before != null ? <th scope="col">{t("audit.before")}</th> : null}
                        {open.after != null ? <th scope="col">{t("audit.after")}</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((f) => (
                        <tr
                          key={JSON.stringify(f.path)}
                          className={hasBoth && f.changed ? "audit-changed" : ""}
                        >
                          <th scope="row">{fieldName(f.path)}</th>
                          {open.before != null ? <td>{value(f.before)}</td> : null}
                          {open.after != null ? <td>{value(f.after)}</td> : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>{t(fields.length ? "audit.noChanges" : "audit.noDetails")}</p>
              )}
            </section>
            <details className="audit-technical">
              <summary>{t("audit.technical")}</summary>
              <dl className="mk-facts">
                <div>
                  <dt>{t("audit.action")}</dt>
                  <dd>
                    <bdi>{open.action}</bdi>
                  </dd>
                </div>
                <div>
                  <dt>{t("audit.entityId")}</dt>
                  <dd>
                    <bdi>{open.entityId}</bdi>
                  </dd>
                </div>
                <div>
                  <dt>{t("audit.correlation")}</dt>
                  <dd>
                    <bdi>{open.correlationId}</bdi>
                  </dd>
                </div>
              </dl>
              <h4>{t("audit.before")}</h4>
              <pre className="mk-json" dir="ltr">
                {JSON.stringify(open.before, null, 2)}
              </pre>
              <h4>{t("audit.after")}</h4>
              <pre className="mk-json" dir="ltr">
                {JSON.stringify(open.after, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
