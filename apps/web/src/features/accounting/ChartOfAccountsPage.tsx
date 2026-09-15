import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TreeTable } from "primereact/treetable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import type { TreeNode } from "primereact/treenode";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { buildAccountTree } from "./build-account-tree";
import { useChartOfAccounts, type ChartOfAccountEntry } from "./use-chart-of-accounts";

export function ChartOfAccountsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useChartOfAccounts();

  const tree = useMemo(() => (data ? buildAccountTree(data) : []), [data]);

  if (isPending) {
    return <PageSkeleton />;
  }

  if (isError || !data) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("accounting.chartOfAccounts.title")}</h1>
          <p className="erp-page__subtitle">{t("accounting.chartOfAccounts.subtitle")}</p>
        </div>
      </div>

      {data.length === 0 ? (
        <p className="erp-page__empty">{t("status.empty")}</p>
      ) : (
        <TreeTable value={tree} className="erp-table" showGridlines emptyMessage={t("status.empty")}>
          <Column
            field="code"
            header={t("accounting.chartOfAccounts.code")}
            expander
            style={{ width: "10rem" }}
            body={(node: TreeNode) => (node.data as ChartOfAccountEntry).code}
          />
          <Column
            field="name"
            header={t("accounting.chartOfAccounts.name")}
            body={(node: TreeNode) => (node.data as ChartOfAccountEntry).name}
          />
          <Column
            field="isPostable"
            header={t("accounting.chartOfAccounts.kind")}
            style={{ width: "10rem" }}
            body={(node: TreeNode) => {
              const account = node.data as ChartOfAccountEntry;
              return account.isPostable ? (
                <Tag value={t("accounting.chartOfAccounts.postable")} severity="info" />
              ) : (
                <Tag value={t("accounting.chartOfAccounts.group")} severity="secondary" />
              );
            }}
          />
        </TreeTable>
      )}
    </div>
  );
}
