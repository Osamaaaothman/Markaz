import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePermissions } from "../../shared/auth/use-permissions";
import { documentPath } from "../../shared/lib/document-path";
import { recordedNumber } from "./audit-details";
import type { AuditLogEntry, AuditReference } from "./use-audit-log";

export function useAuditPresentation() {
  const { t } = useTranslation();
  const { can } = usePermissions();
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

  return { when, entityName, actionName, reference, number };
}
