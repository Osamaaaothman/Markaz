import { useState } from "react";
import { Link } from "react-router-dom";
import "./compliance.css";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { apiClient } from "../../shared/api/client";
import { downloadBlob } from "../../shared/lib/download-file";
import { formatDateTime } from "../../shared/lib/format-date";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { usePermissions } from "../../shared/auth/use-permissions";
import { useComplianceOverview, useInvoiceRecord, useInvoiceStatuses, useResubmitInvoice, useSubmissionReadiness } from "./use-compliance";

function statusSeverity(status: string): "success" | "warning" | "danger" | "info" | "secondary" {
  if (status === "CLEARED" || status === "REPORTED") return "success";
  if (["FAILED_RETRYABLE", "SUBMITTING", "ACCEPTED_WITH_WARNINGS"].includes(status)) return "warning";
  if (status === "REJECTED" || status === "FAILED") return "danger";
  return "info";
}

export function ZatcaInvoicePanel({ salesInvoiceId }: { readonly salesInvoiceId: string }): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const { data: record, isError, isPending, refetch } = useInvoiceRecord(salesInvoiceId);
  const overview = useComplianceOverview();
  const statuses = useInvoiceStatuses(record === null ? [salesInvoiceId] : []);
  const resubmit = useResubmitInvoice();
  const [downloadError, setDownloadError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const readiness = useSubmissionReadiness(salesInvoiceId, Boolean(record || statuses.data?.[salesInvoiceId]));
  if (!can("compliance:read")) return null;
  const pendingStatus = statuses.data?.[salesInvoiceId];
  const environment = record?.environment ?? pendingStatus?.environment;
  const retryEnabled = overview.data?.capabilities.resubmit && (record?.canResubmit || (!record && pendingStatus));
  const issue = readiness.data?.issue;
  const blocker = readiness.data?.blockingInvoice;
  const date = (value: string | null): string => value ? formatDateTime(value, i18n.language) : "—";
  const downloadXml = async (kind: "signed" | "cleared"): Promise<void> => {
    setDownloadError(false); setDownloading(true);
    try {
      const response = await apiClient.get<Blob>(`/v1/compliance/invoices/${salesInvoiceId}/xml`, { params: { kind }, responseType: "blob" });
      downloadBlob(response.data, `${record?.invoiceNumber ?? salesInvoiceId}-${kind}.xml`);
    } catch { setDownloadError(true); } finally { setDownloading(false); }
  };
  return (
    <section className="erp-card">
      <div className="erp-card__header">
        <h2 className="erp-card__title">{t("compliance.invoicePanel.title")}</h2>
        {record?.status === "ACCEPTED_WITH_WARNINGS" && record.authorityStatus ? <Tag value={<><span>{t(`compliance.invoiceStatus.${record.authorityStatus}`)}</span> <bdi>({record.authorityStatus})</bdi></>} severity="success" /> : null}
        <ZatcaStatusBadge status={record?.status ?? pendingStatus?.status} />
        {environment ? <Tag value={t(`compliance.environment.${environment}`)} severity={environment === "production" ? "success" : "warning"} /> : null}
      </div>
      {environment && environment !== "production" ? <p role="note" className="compliance-test-notice">{t("compliance.testNotice")} {t(`compliance.environmentHint.${environment}`)}</p> : null}
      {isPending ? <p>{t("status.loading")}</p> : isError ? <p role="alert">{t("status.error")} <Button label={t("actions.retry")} text onClick={() => void refetch()} /></p> : !record ? <p>{t(pendingStatus ? "compliance.invoicePanel.awaiting" : "compliance.invoicePanel.notLinked")}</p> : (
        <>
          <dl className="erp-detail-grid">
            <dt>{t("compliance.invoicePanel.egs")}</dt><dd>{record.egsName}</dd>
            <dt>{t("compliance.invoicePanel.uuid")}</dt><dd dir="ltr" style={{ overflowWrap: "anywhere" }}>{record.uuid}</dd>
            <dt>{t("compliance.invoicePanel.icv")}</dt><dd>{record.icv}</dd>
            <dt>{t("compliance.invoicePanel.attempts")}</dt><dd>{record.attempts}</dd>
            <dt>{t("compliance.invoicePanel.submittedAt")}</dt><dd>{date(record.submittedAt)}</dd>
            <dt>{t("compliance.invoicePanel.clearedAt")}</dt><dd>{date(record.clearedAt)}</dd>
            <dt>{t("compliance.invoicePanel.reportedAt")}</dt><dd>{date(record.reportedAt)}</dd>
          </dl>
          {record.warnings.length ? <ul className="erp-field__hint">{record.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
          {record.errors.length ? <ul role="alert" className="erp-auth-card__error">{record.errors.map((error, index) => <li key={index}>{error}</li>)}</ul> : null}
          {record.errors.some((error) => error.startsWith("SIGNATURE_INVALID:")) ? <p role="note" className="compliance-test-notice">{t(environment === "sandbox" ? "compliance.invoicePanel.sandboxSignatureInvalid" : "compliance.invoicePanel.signatureInvalid")}</p> : null}
          {environment === "sandbox" && record.errors.some((error) => error.startsWith("certificate-permissions:")) ? <p role="note" className="compliance-test-notice">{t("compliance.invoicePanel.sandboxSellerMismatch")}</p> : null}
          {record.qrImageDataUrl ? <figure style={{ marginInline: 0 }}>
            <img src={record.qrImageDataUrl} alt={t("compliance.invoicePanel.qr")} width={280} height={280} style={{ maxWidth: "100%", height: "auto", imageRendering: "pixelated" }} />
            <figcaption>{t(`compliance.invoicePanel.qrSource.${record.qrSource}`)}</figcaption>
            <a href={record.qrImageDataUrl} download={`${record.invoiceNumber}-qr.png`} className="erp-button-link">{t("compliance.invoicePanel.downloadQr")}</a>
          </figure> : record.dataPreviewQrImageDataUrl ? <figure style={{ marginInline: 0 }}>
            <figcaption className="compliance-test-notice">{t("compliance.invoicePanel.dataPreviewNotice")}</figcaption>
            <img src={record.dataPreviewQrImageDataUrl} alt={t("compliance.invoicePanel.dataPreviewTitle")} width={280} height={280} style={{ maxWidth: "100%", height: "auto", imageRendering: "pixelated" }} />
            <figcaption>{t("compliance.invoicePanel.dataPreviewFields")}</figcaption>
            <a href={record.dataPreviewQrImageDataUrl} download={`${record.invoiceNumber}-data-preview-qr.png`} className="erp-button-link">{t("compliance.invoicePanel.downloadQr")}</a>
          </figure> : <p className="erp-field__hint">{t("compliance.invoicePanel.qrUnavailable")}</p>}
          <p className="erp-field__hint">{t("compliance.invoicePanel.scanHint")}</p>
          <div className="erp-row-actions">
            {record.hasSignedXml ? <Button label={t("compliance.invoicePanel.downloadSigned")} icon="pi pi-file" outlined disabled={downloading} onClick={() => void downloadXml("signed")} /> : null}
            {record.hasClearedXml ? <Button label={t("compliance.invoicePanel.downloadCleared")} icon="pi pi-verified" outlined disabled={downloading} onClick={() => void downloadXml("cleared")} /> : null}
          </div>
          <details style={{ marginBlock: "1rem" }}>
            <summary>{t("compliance.invoicePanel.history")}</summary>
            {record.history.length === 0 ? <p>{t("compliance.invoicePanel.noHistory")}</p> : <ol>
              {record.history.map((attempt) => <li key={attempt.id} style={{ marginBlock: "1rem" }}>
                <p>{date(attempt.startedAt)} — {t(`compliance.attemptStage.${attempt.stage}`)} — <ZatcaStatusBadge status={attempt.status} /></p>
                <p>{t("compliance.invoicePanel.completedAt")}: {date(attempt.completedAt)}{attempt.httpStatus ? ` (HTTP ${attempt.httpStatus})` : ""}</p>
                {[...attempt.warnings, ...attempt.errors].map((message, index) => <p key={index}>{message}</p>)}
              </li>)}
            </ol>}
          </details>
        </>
      )}
      {issue ? <div role="alert" className="compliance-test-notice">
        <strong>{t("compliance.invoicePanel.blocked")}</strong>
        <p>{t(`compliance.submissionIssue.${issue}`, { defaultValue: t("compliance.invoicePanel.resubmitError") })}</p>
        {environment === "sandbox" && issue === "CERTIFICATE_KEY_MISMATCH" ? <p>{t("compliance.invoicePanel.sandboxCertificateHint")}</p> : null}
        {blocker ? <p>{t("compliance.invoicePanel.blockingInvoice")}: {can("sales_invoice:read") ? <Link to={`/sales/invoices/${blocker.id}`}><bdi>{blocker.number}</bdi></Link> : <bdi>{blocker.number}</bdi>}</p> : null}
      </div> : null}
      {readiness.data?.warning === "CERTIFICATE_SELLER_MISMATCH" ? <p role="note" className="compliance-test-notice">{t("compliance.invoicePanel.sandboxSubmissionWarning")}</p> : null}
      {retryEnabled ? <PermissionButton allowed={can("compliance:manage")} label={t("compliance.invoicePanel.resubmit")} icon="pi pi-refresh" loading={resubmit.isPending} disabled={readiness.data?.canSubmit !== true || readiness.isFetching} onClick={() => resubmit.mutate(salesInvoiceId)} /> : null}
      {retryEnabled && readiness.isError ? <p role="alert">{t("status.error")} <Button text label={t("actions.retry")} onClick={() => void readiness.refetch()} /></p> : null}
      {(resubmit.isError && !issue) || downloadError ? <p role="alert" className="erp-auth-card__error">{t(downloadError ? "compliance.invoicePanel.downloadError" : "compliance.invoicePanel.resubmitError")}</p> : null}
    </section>
  );
}

export function ZatcaStatusBadge({ status }: { readonly status: string | undefined }): React.JSX.Element | null {
  const { t } = useTranslation();
  return status ? <Tag value={t(`compliance.invoiceStatus.${status}`)} severity={statusSeverity(status)} /> : null;
}
