import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { auditFields } from "./audit-details";
import { useAuditPresentation } from "./audit-presentation";
import type { AuditLogEntry } from "./use-audit-log";
import "./audit.css";

export function AuditEntryDialog({
  entry: open,
  onHide,
  onHistory,
}: {
  entry: AuditLogEntry | null;
  onHide: () => void;
  onHistory: (entry: AuditLogEntry) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [onlyChanged, setOnlyChanged] = useState(true);
  const { when, entityName, actionName, reference, number } = useAuditPresentation();
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

  return (
    <Dialog
      header={open ? actionName(open.action) : ""}
      visible={open !== null}
      onHide={onHide}
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
              onHistory(open);
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
  );
}
