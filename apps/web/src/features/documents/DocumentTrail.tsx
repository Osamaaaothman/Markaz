import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { apiClient } from "../../shared/api/client";

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
const paths: Record<string, string> = {
  purchase_order: "/purchasing/orders/",
  goods_receipt: "/inventory/goods-receipts/",
  supplier_invoice: "/purchasing/invoices/",
  sales_order: "/sales/orders/",
  sales_invoice: "/sales/invoices/",
  stock_issue: "/inventory/stock-issues/",
  stock_count: "/inventory/stock-counts/",
};
export function DocumentTrail({ kind, id }: { kind: string; id: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const result = useQuery({
    queryKey: ["documentTrail", kind, id],
    queryFn: async () => (await apiClient.get<Trail>(`/v1/document-trail/${kind}/${id}`)).data,
    enabled: open,
  });
  return (
    <section className="erp-document-trail">
      <Button
        type="button"
        text
        icon="pi pi-history"
        label={t("trail.title")}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
      {open ? (
        <div>
          <p>{t("trail.subtitle")}</p>
          {result.isPending ? (
            <p>{t("drafts.loading")}</p>
          ) : result.isError ? (
            <Button
              label={t("actions.retry")}
              onClick={() => {
                void result.refetch();
              }}
            />
          ) : null}
          <ol className="erp-document-trail__list">
            {result.data?.nodes.map((node) => {
              const nodeKey = `${node.kind}:${node.id}`;
              const relatedKeys = new Set(
                result.data.edges
                  .filter((e) => e.from === nodeKey || e.to === nodeKey)
                  .flatMap((e) => [e.from, e.to])
                  .filter((key) => key !== nodeKey),
              );
              const related = result.data.nodes
                .filter((n) => relatedKeys.has(`${n.kind}:${n.id}`))
                .map((n) => n.number)
                .join(" · ");
              return (
                <li
                  key={nodeKey}
                  className={
                    node.id === id && node.kind === kind ? "erp-document-trail__current" : ""
                  }
                >
                  <strong>
                    {t(`trail.kinds.${node.kind}`)}:{" "}
                    {paths[node.kind] ? (
                      <Link to={`${paths[node.kind]}${node.id}`}>{node.number}</Link>
                    ) : (
                      <bdi>{node.number}</bdi>
                    )}
                  </strong>
                  <span>
                    {t(`trail.statuses.${node.status}`, { defaultValue: t("trail.recorded") })} ·{" "}
                    <time>{node.date}</time>
                  </span>
                  {related ? (
                    <small>
                      {t("trail.related")}: <bdi>{related}</bdi>
                    </small>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {result.data?.truncated ? <p>{t("trail.truncated")}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
