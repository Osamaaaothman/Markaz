import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { SelectButton } from "primereact/selectbutton";
import { DataGrid } from "../../shared/ui/DataGrid";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { RejectDialog, RequestDetailDialog } from "./PurchaseRequestsPage";
import { RequestStatusTag } from "./StatusTags";
import { useAcceptPurchaseRequest, usePurchaseRequests, type PurchaseRequestSummary } from "./use-purchasing";

type View = "PENDING" | "ACCEPTED";

// Where requests are decided. A reviewer accepts a request (a buyer may then make an order from it) or rejects it with a
// reason. Accepted requests stay listed so a reviewer can still change their mind until an order has been made.
export function PurchaseRequestReviewPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const [view, setView] = useState<View>("PENDING");
  const [viewId, setViewId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const accept = useAcceptPurchaseRequest();

  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = usePurchaseRequests(view);
  const requests = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("purchasing.review.title")}</h1>
          <p className="erp-page__subtitle">{t("purchasing.review.subtitle")}</p>
        </div>
      </div>

      <div className="coa-toolbar">
        <SelectButton
          value={view}
          allowEmpty={false}
          onChange={(e) => setView((e.value as View | null) ?? "PENDING")}
          options={[
            { label: t("purchasing.review.toReview"), value: "PENDING" },
            { label: t("purchasing.review.accepted"), value: "ACCEPTED" },
          ]}
        />
      </div>

      {accept.isError ? <p className="erp-page__error">{t("purchasing.review.acceptError")}</p> : null}

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
          <DataGrid
            value={requests}
            className="erp-table"
            stripedRows
            showGridlines
            size="small"
            emptyMessage={t(view === "PENDING" ? "purchasing.review.emptyPending" : "purchasing.review.emptyAccepted")}
          >
            <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(row: PurchaseRequestSummary) => <span className="coa-code">{row.number}</span>} />
            <Column header={t("purchasing.date")} style={{ width: "8rem" }} body={(row: PurchaseRequestSummary) => formatCalendarDate(row.createdAt, i18n.language)} />
            <Column header={t("created.warehouse")} body={(row: PurchaseRequestSummary) => (row.warehouseName ? localizedName({ name: row.warehouseName, nameAr: row.warehouseNameAr }, i18n.language) : "—")} />
            <Column header={t("purchasing.requests.notes")} body={(row: PurchaseRequestSummary) => row.notes ?? ""} />
            <Column header={t("purchasing.lineCount")} style={{ width: "6rem" }} align="right" body={(row: PurchaseRequestSummary) => row.lineCount} />
            <Column header={t("purchasing.status")} style={{ width: "9rem" }} body={(row: PurchaseRequestSummary) => <RequestStatusTag status={row.status} />} />
            <Column
              header=""
              style={{ width: "22rem" }}
              body={(row: PurchaseRequestSummary) => (
                <div className="erp-row-actions">
                  <Button label={t("purchasing.view")} size="small" text onClick={() => setViewId(row.id)} />
                  {row.status === "PENDING" ? (
                    <PermissionButton
                      allowed={can("purchase_request:review")}
                      label={t("purchasing.review.accept")}
                      size="small"
                      text
                      loading={accept.isPending && accept.variables === row.id}
                      onClick={() => accept.mutate(row.id)}
                    />
                  ) : null}
                  <PermissionButton
                    allowed={can("purchase_request:reject")}
                    label={t("purchasing.requests.reject")}
                    size="small"
                    text
                    severity="danger"
                    onClick={() => setRejectId(row.id)}
                  />
                </div>
              )}
            />
          </DataGrid>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}

      <RequestDetailDialog id={viewId} onHide={() => setViewId(null)} />
      <RejectDialog id={rejectId} onHide={() => setRejectId(null)} />
    </div>
  );
}
