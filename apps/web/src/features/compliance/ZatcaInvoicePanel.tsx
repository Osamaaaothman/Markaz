import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { apiClient } from "../../shared/api/client";
import { downloadBlob } from "../../shared/lib/download-file";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { usePermissions } from "../../shared/auth/use-permissions";
import { useInvoiceRecord, useResubmitInvoice, type InvoiceRecordView } from "./use-compliance";

function statusSeverity(status: string): "success" | "warning" | "danger" | "info" | "secondary" {
  if (status === "CLEARED" || status === "REPORTED") return "success";
  if (status === "FAILED_RETRYABLE" || status === "SUBMITTING") return "warning";
  if (status === "REJECTED" || status === "FAILED") return "danger";
  if (status === "PENDING") return "info";
  return "secondary";
}

// Shown on a sales invoice's detail page. A 404 (no ZATCA record) is a normal state — ZATCA
// submission is not wired to real invoices yet (docs/01-OPEN-DECISIONS.md section Z) — so this
// renders nothing rather than an error, until that changes.
export function ZatcaInvoicePanel({ salesInvoiceId, resubmitEnabled }: { readonly salesInvoiceId: string; readonly resubmitEnabled: boolean }): React.JSX.Element | null {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const { data: record, isError, isPending } = useInvoiceRecord(salesInvoiceId);
  const resubmit = useResubmitInvoice();

  if (!can("compliance:read") || isPending || isError || !record) return null;

  // The XML endpoint needs the same Authorization header as every other API call, so it can't be a plain
  // <a href>/window.open link (the browser would send no bearer token and get a 401) -- fetch the blob through
  // the authenticated client instead, the same way every other download in this app works (shared/lib/download-file.ts).
  const downloadXml = async (kind: "signed" | "cleared"): Promise<void> => {
    const response = await apiClient.get<Blob>(`/v1/compliance/invoices/${salesInvoiceId}/xml`, { params: { kind }, responseType: "blob" });
    downloadBlob(response.data, `${salesInvoiceId}-${kind}.xml`);
  };

  return (
    <section className="erp-card">
      <div className="erp-card__header">
        <h2 className="erp-card__title">{t("compliance.invoicePanel.title")}</h2>
        <Tag value={t(`compliance.invoiceStatus.${record.status}`)} severity={statusSeverity(record.status)} />
        <Tag value={t(`compliance.environment.${record.environment}`)} severity={record.environment === "production" ? "danger" : "secondary"} />
      </div>

      {record.warnings.length > 0 ? (
        <ul className="erp-field__hint">
          {record.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      ) : null}
      {record.errors.length > 0 ? (
        <ul className="erp-auth-card__error">
          {record.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      ) : null}

      <div className="erp-row-actions">
        {record.hasSignedXml ? <Button type="button" label={t("compliance.invoicePanel.downloadSigned")} icon="pi pi-file" outlined onClick={() => void downloadXml("signed")} /> : null}
        {record.hasClearedXml ? <Button type="button" label={t("compliance.invoicePanel.downloadCleared")} icon="pi pi-verified" outlined onClick={() => void downloadXml("cleared")} /> : null}
        {resubmitEnabled && record.canResubmit ? (
          <PermissionButton allowed={can("compliance:manage")} label={t("compliance.invoicePanel.resubmit")} icon="pi pi-refresh" loading={resubmit.isPending} onClick={() => resubmit.mutate(salesInvoiceId)} />
        ) : null}
      </div>
      {resubmit.isError ? <p className="erp-auth-card__error">{t("compliance.invoicePanel.resubmitError")}</p> : null}
    </section>
  );
}

// Compact badge for a list row (sales invoice list, once wired there) — not yet used, kept
// alongside the panel since the data hook (useInvoiceStatuses) already supports batching it.
export function ZatcaStatusBadge({ status }: { readonly status: InvoiceRecordView["status"] | undefined }): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!status) return null;
  return <Tag value={t(`compliance.invoiceStatus.${status}`)} severity={statusSeverity(status)} />;
}
