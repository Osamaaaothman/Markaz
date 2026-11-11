import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { useState } from "react";
import { apiClient } from "../../shared/api/client";

export const DRAFT_ROUTES: Record<string, string> = {
  customer_receipt: "/payments/receipts/new",
  supplier_payment: "/payments/supplier/new",
  quotation: "/sales/quotations/new",
  sales_order: "/sales/orders/new",
  sales_invoice: "/sales/invoices/new",
  purchase_order: "/purchasing/orders/new",
  supplier_invoice: "/purchasing/invoices/new",
  goods_receipt: "/inventory/goods-receipts/new",
  stock_issue: "/inventory/stock-issues/new",
  stock_count: "/inventory/stock-counts",
  journal_entry: "/accounting/journal-entries",
  cash_expense: "/payments/cash-expenses/new",
  purchase_request: "/purchasing/requests",
};
interface DraftRow {
  id: string;
  kind: string;
  version: number;
  updatedAt: string;
}
export function DraftsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation(),
    qc = useQueryClient();
  const [discarding, setDiscarding] = useState<DraftRow | null>(null);
  const drafts = useQuery({
    queryKey: ["documentDrafts"],
    queryFn: async () => (await apiClient.get<DraftRow[]>("/v1/document-drafts")).data,
  });
  const discard = useMutation({
    mutationFn: (draft: DraftRow) =>
      apiClient.delete(`/v1/document-drafts/${draft.id}`, { data: { version: draft.version } }),
    onSuccess: () => {
      setDiscarding(null);
      void qc.invalidateQueries({ queryKey: ["documentDrafts"] });
    },
  });
  return (
    <div className="erp-page">
      <h1>{t("drafts.title")}</h1>
      <p>{t("drafts.subtitle")}</p>
      {drafts.isPending ? (
        <p>{t("drafts.loading")}</p>
      ) : drafts.isError ? (
        <Button
          label={t("actions.retry")}
          onClick={() => {
            void drafts.refetch();
          }}
        />
      ) : null}
      {drafts.data?.length === 0 ? <p>{t("drafts.empty")}</p> : null}
      {(drafts.data ?? []).map((draft) => (
        <div className="erp-draft-bar" key={draft.id}>
          <Link to={`${DRAFT_ROUTES[draft.kind] ?? "/documents/drafts"}?draft=${draft.id}`}>
            {t(`drafts.kinds.${draft.kind}`)}
          </Link>
          <time dateTime={draft.updatedAt}>
            {new Date(draft.updatedAt).toLocaleString(i18n.language)}
          </time>
          <Button
            label={t("drafts.discard")}
            severity="danger"
            text
            loading={discard.isPending}
            onClick={() => setDiscarding(draft)}
          />
        </div>
      ))}
      <Dialog
        visible={discarding !== null}
        onHide={() => setDiscarding(null)}
        header={t("drafts.discard")}
        className="erp-dialog"
        modal
      >
        <p>{t("drafts.confirmDiscard")}</p>
        <div className="erp-form__actions">
          <Button label={t("actions.cancel")} text onClick={() => setDiscarding(null)} />
          <Button
            label={t("drafts.discard")}
            severity="danger"
            loading={discard.isPending}
            onClick={() => {
              if (discarding) discard.mutate(discarding);
            }}
          />
        </div>
      </Dialog>
    </div>
  );
}
