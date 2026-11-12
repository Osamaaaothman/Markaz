import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Tag } from "primereact/tag";
import { apiClient } from "../../shared/api/client";
import { formatDateTime } from "../../shared/lib/format-date";
interface Attempt {
  id: string;
  recipient: string;
  language: "ar" | "en";
  status: string;
  createdAt: string;
  sentAt: string | null;
  checkedAt: string | null;
  errorCode: string | null;
  provider: string | null;
}
interface History {
  data: Attempt[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}
export function QuotationEmailHistory({
  quotationId,
  visible,
  disabled,
  onResend,
}: {
  quotationId: string;
  visible: boolean;
  disabled: boolean;
  onResend: (to: string, language: "ar" | "en") => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const history = useInfiniteQuery({
    queryKey: ["quotationEmails", quotationId],
    enabled: visible,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<History>(`/v1/quotations/${quotationId}/email/history`, {
          params: pageParam ? { cursor: pageParam } : {},
        })
      ).data,
    getNextPageParam: (page) => page.pageInfo.nextCursor ?? undefined,
  });
  const refresh = useMutation({
    mutationFn: async (id: string) =>
      apiClient.post(`/v1/quotations/${quotationId}/email/${id}/refresh`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quotationEmails", quotationId] }),
  });
  return (
    <section>
      <h3>{t("emailHistory.title")}</h3>
      <p className="erp-field__hint">{t("emailHistory.hint")}</p>
      {history.isError || refresh.isError ? <p role="alert">{t("emailHistory.error")}</p> : null}
      <Button
        type="button"
        text
        label={t("emailHistory.reload")}
        loading={history.isFetching}
        onClick={() => void history.refetch()}
      />
      <DataTable
        value={history.data?.pages.flatMap((page) => page.data) ?? []}
        cellMemo={false}
        loading={history.isPending}
        emptyMessage={t("status.empty")}
        size="small"
        scrollable
      >
        <Column
          header={t("emailHistory.recipient")}
          body={(row: Attempt) => <bdi>{row.recipient}</bdi>}
        />
        <Column
          header={t("emailHistory.time")}
          body={(row: Attempt) => formatDateTime(row.sentAt ?? row.createdAt, i18n.language)}
        />
        <Column
          header={t("emailHistory.status")}
          body={(row: Attempt) => (
            <Tag
              severity={
                row.status === "DELIVERED"
                  ? "success"
                  : ["FAILED", "BOUNCED", "COMPLAINED"].includes(row.status)
                    ? "danger"
                    : ["UNKNOWN", "DELAYED"].includes(row.status)
                      ? "warning"
                      : "info"
              }
              value={t(`emailHistory.states.${row.status}`, row.status)}
            />
          )}
        />
        <Column
          header={t("emailHistory.checked")}
          body={(row: Attempt) =>
            row.checkedAt ? formatDateTime(row.checkedAt, i18n.language) : "—"
          }
        />
        <Column
          header={t("emailHistory.actions")}
          body={(row: Attempt) => (
            <div className="erp-page__header-actions">
              {row.provider === "resend" ? (
                <Button
                  type="button"
                  text
                  label={t("emailHistory.refresh")}
                  disabled={disabled || refresh.isPending}
                  onClick={() => refresh.mutate(row.id)}
                />
              ) : null}
              <Button
                type="button"
                text
                label={t("emailHistory.resend")}
                disabled={disabled || ["SENDING", "UNKNOWN"].includes(row.status)}
                onClick={() => onResend(row.recipient, row.language)}
              />
            </div>
          )}
        />
      </DataTable>
      {history.hasNextPage ? (
        <Button
          type="button"
          text
          label={t("actions.loadMore")}
          loading={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        />
      ) : null}
    </section>
  );
}
