import { documentPath } from "../../shared/lib/document-path";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { TabPanel, TabView } from "primereact/tabview";
import { Tag } from "primereact/tag";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { DocumentActivity, DOCUMENT_AUDIT_ENTITIES } from "./DocumentActivity";

interface TrailNode {
  kind: string;
  id: string;
  number: string;
  status: string;
  date: string;
  createdAt: string;
}
interface Trail {
  nodes: TrailNode[];
  edges: { from: string; to: string }[];
  truncated: boolean;
}
const ICONS: Readonly<Record<string, string>> = {
  sales_invoice: "pi-file",
  supplier_invoice: "pi-file",
  payment: "pi-wallet",
  journal_entry: "pi-book",
  quotation: "pi-file-edit",
  sales_order: "pi-shopping-cart",
  purchase_order: "pi-shopping-bag",
  goods_receipt: "pi-box",
  stock_issue: "pi-truck",
};

export function DocumentTrail({ kind, id }: { kind: string; id: string }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const result = useQuery({
    queryKey: ["documentTrail", kind, id],
    queryFn: async () => (await apiClient.get<Trail>(`/v1/document-trail/${kind}/${id}`)).data,
    enabled: id !== "",
    staleTime: 10_000,
  });
  const entityType = DOCUMENT_AUDIT_ENTITIES[kind];
  const link = (node: TrailNode): React.ReactNode => {
    const path = documentPath(node.kind, node.id);
    return path ? (
      <Link to={path}>
        <bdi>{node.number}</bdi>
        <i className="pi pi-arrow-up-right" aria-hidden="true" />
      </Link>
    ) : (
      <bdi>{node.number}</bdi>
    );
  };
  return (
    <section className="erp-card mk-document-history" aria-label={t("trail.title")}>
      <h2 className="erp-card__title">{t("trail.title")}</h2>
      <TabView>
        <TabPanel
          header={t("trail.relatedDocuments")}
          leftIcon={<i className="pi pi-sitemap" aria-hidden="true" />}
        >
          <div className="mk-document-section-header">
            <p className="erp-field__hint">{t("trail.subtitle")}</p>
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
          ) : (
            <ol className="mk-document-flow">
              {result.data?.nodes.map((node) => {
                const key = `${node.kind}:${node.id}`;
                const current = node.kind === kind && node.id === id;
                const relatedKeys = new Set(
                  result.data.edges
                    .filter((edge) => edge.from === key || edge.to === key)
                    .flatMap((edge) => [edge.from, edge.to])
                    .filter((other) => other !== key),
                );
                const related = result.data.nodes.filter((other) =>
                  relatedKeys.has(`${other.kind}:${other.id}`),
                );
                return (
                  <li
                    key={key}
                    className={current ? "mk-document-flow__current" : ""}
                    aria-current={current ? "true" : undefined}
                  >
                    <span className="mk-document-flow__icon">
                      <i className={`pi ${ICONS[node.kind] ?? "pi-file"}`} aria-hidden="true" />
                    </span>
                    <div className="mk-document-flow__body">
                      <div className="mk-document-flow__heading">
                        <span>{t(`trail.kinds.${node.kind}`)}</span>
                        {current ? <Tag value={t("trail.current")} /> : null}
                      </div>
                      <strong>{link(node)}</strong>
                      <div className="mk-document-flow__meta">
                        <Tag
                          severity={
                            node.status === "VOIDED" || node.status === "REJECTED"
                              ? "danger"
                              : "secondary"
                          }
                          value={t(`trail.statuses.${node.status}`, {
                            defaultValue: t("trail.recorded"),
                          })}
                        />
                        <time dateTime={node.date}>
                          {formatCalendarDate(node.date, i18n.language)}
                        </time>
                      </div>
                      {related.length ? (
                        <div className="mk-document-flow__relations">
                          <span>{t("trail.related")}</span>
                          {related.map((other) => (
                            <span key={`${other.kind}:${other.id}`}>{link(other)}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {result.data?.truncated ? <p role="note">{t("trail.truncated")}</p> : null}
        </TabPanel>
        {entityType && can("audit_log:read") ? (
          <TabPanel
            header={t("trail.activity")}
            leftIcon={<i className="pi pi-history" aria-hidden="true" />}
          >
            <DocumentActivity key={`${entityType}:${id}`} entityType={entityType} id={id} />
          </TabPanel>
        ) : null}
      </TabView>
    </section>
  );
}
