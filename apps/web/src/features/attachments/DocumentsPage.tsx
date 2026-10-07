import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { DataGrid } from "../../shared/ui/DataGrid";
import { AttachmentViewer, type ViewedFile } from "./AttachmentViewer";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import {
  ATTACHMENT_OWNER_TYPES,
  downloadAttachment,
  formatBytes,
  useAllAttachments,
  type AttachmentOwnerType,
  type AttachmentSummary,
} from "./use-attachments";

const ALL = "__all__";

// Where a record can be opened from. Types without a detail screen show their name only.
const OWNER_ROUTES: Partial<Record<AttachmentOwnerType, (id: string) => string>> = {
  SALES_INVOICE: (id) => `/sales/invoices/${id}`,
  PURCHASE_ORDER: (id) => `/purchasing/orders/${id}`,
};

// The documents center: every attached file in the company in one list, filtered by the kind of record or by name.
// People who may not read a kind of record never see its files (the API leaves them out).
export function DocumentsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [ownerType, setOwnerType] = useState<AttachmentOwnerType | null>(null);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [viewing, setViewing] = useState<ViewedFile | null>(null);
  const { data, isPending, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useAllAttachments(ownerType, applied);
  const rows = data?.pages.flatMap((p) => p.data) ?? [];
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("attachments.pageTitle")}</h1>
          <p className="erp-page__subtitle">{t("attachments.pageSubtitle")}</p>
        </div>
      </div>

      <div className="coa-toolbar">
        <form
          className="coa-search"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(query.trim());
          }}
        >
          <InputText value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("attachments.searchPlaceholder")} aria-label={t("attachments.searchPlaceholder")} />
          <Button type="submit" icon="pi pi-search" aria-label={t("actions.search")} />
        </form>
        <div className="coa-levels">
          <span className="coa-levels__label">{t("attachments.kind")}</span>
          <Dropdown
            value={ownerType ?? ALL}
            onChange={(e) => setOwnerType(e.value === ALL ? null : (e.value as AttachmentOwnerType))}
            options={[{ label: t("attachments.allKinds"), value: ALL }, ...ATTACHMENT_OWNER_TYPES.map((type) => ({ label: t(`attachments.owners.${type}`), value: type }))]}
          />
        </div>
      </div>

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
          <DataGrid value={rows} searchable={false} stripedRows showGridlines size="small" emptyMessage={t("attachments.empty")}>
            <Column header={t("attachments.file")} body={(r: AttachmentSummary) => <span dir="auto">{r.originalName}</span>} />
            <Column header={t("attachments.kind")} style={{ width: "12rem" }} body={(r: AttachmentSummary) => <Tag value={t(`attachments.owners.${r.ownerType}`)} severity="secondary" className="mk-tag--plain" />} />
            <Column
              header={t("attachments.record")}
              style={{ minWidth: "13rem" }}
              body={(r: AttachmentSummary) => {
                const route = OWNER_ROUTES[r.ownerType];
                return route ? (
                  <button type="button" className="erp-button-link" onClick={() => void navigate(route(r.ownerId))}>
                    {r.ownerLabel ?? "—"}
                  </button>
                ) : (
                  (r.ownerLabel ?? "—")
                );
              }}
            />
            <Column header={t("attachments.size")} align="right" style={{ width: "7rem" }} body={(r: AttachmentSummary) => <span dir="ltr">{formatBytes(r.sizeBytes)}</span>} />
            <Column header={t("attachments.uploaded")} style={{ width: "13rem" }} body={(r: AttachmentSummary) => <bdi>{when.format(new Date(r.createdAt))}</bdi>} />
            <Column header={t("attachments.by")} body={(r: AttachmentSummary) => <bdi dir="ltr">{r.createdByEmail ?? "—"}</bdi>} />
            <Column
              header=""
              style={{ width: "7rem" }}
              body={(r: AttachmentSummary) => (
                <div className="mk-attach__actions">
                  <Button type="button" icon="pi pi-eye" text rounded aria-label={t("attachments.open")} tooltip={t("attachments.open")} onClick={() => setViewing(r)} />
                  <Button type="button" icon="pi pi-download" text rounded aria-label={t("attachments.download")} tooltip={t("attachments.download")} onClick={() => void downloadAttachment(r.id, r.originalName)} />
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
      <AttachmentViewer file={viewing} onHide={() => setViewing(null)} />
    </div>
  );
}
