import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { selectFilter } from "../../shared/ui/column-filters";
import { DataGrid } from "../../shared/ui/DataGrid";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { exportReport } from "../accounting/export-report";
import {
  useQuotation,
  useQuotationAction,
  useQuotations,
  usePreviewQuotationEmail,
  useSendQuotationEmail,
  type QuotationDetail,
  type QuotationStatus,
  type QuotationSummary,
  type SalesLineView,
} from "./use-sales";

const ALL = "ALL";
const STATUSES: readonly QuotationStatus[] = ["OPEN", "CONVERTED", "REJECTED", "CANCELLED"];
const SEVERITY: Record<QuotationStatus, "info" | "success" | "danger" | "secondary"> = { OPEN: "info", CONVERTED: "success", REJECTED: "danger", CANCELLED: "secondary" };

export function QuotationsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [status, setStatus] = useState<QuotationStatus | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useQuotations(status);
  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("sales.quotations.title")}</h1>
          <p className="erp-page__subtitle">{t("sales.quotations.subtitle")}</p>
        </div>
        <PermissionButton allowed={can("quotation:create")} label={t("sales.quotations.new")} icon="pi pi-plus" onClick={() => void navigate("/sales/quotations/new")} />
      </div>

      <div className="coa-toolbar">
        <div className="coa-levels">
          <span className="coa-levels__label">{t("purchasing.status")}</span>
          <Dropdown
            value={status ?? ALL}
            onChange={(e) => setStatus(e.value === ALL ? null : (e.value as QuotationStatus))}
            options={[{ label: t("purchasing.allStatuses"), value: ALL }, ...STATUSES.map((s) => ({ label: t(`sales.quotations.status.${s}`), value: s }))]}
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
          <DataGrid emptyAction={{ allowed: can("quotation:create"), label: t("sales.quotations.new"), onClick: () => void navigate("/sales/quotations/new") }} value={rows} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")} selectionMode="single" onRowClick={(e) => setViewId((e.data as QuotationSummary).id)}>
            <Column field="number" filter header={t("purchasing.number")} style={{ width: "13rem" }} body={(r: QuotationSummary) => <span className="coa-code">{r.number}</span>} />
            <Column header={t("sales.customer")} body={(r: QuotationSummary) => localizedName({ name: r.customerName, nameAr: r.customerNameAr }, i18n.language)} />
            <Column header={t("sales.quotations.date")} style={{ width: "9rem" }} body={(r: QuotationSummary) => formatCalendarDate(r.quotationDate, i18n.language)} />
            <Column header={t("sales.quotations.validUntil")} style={{ width: "9rem" }} body={(r: QuotationSummary) => (r.validUntil ? formatCalendarDate(r.validUntil, i18n.language) : "")} />
            <Column header={t("purchasing.invoices.gross")} align="right" style={{ width: "11rem" }} body={(r: QuotationSummary) => formatMoney(r.totalGross, r.currency)} />
            <Column field="status" filter filterMatchMode="equals" filterElement={selectFilter(Object.keys(SEVERITY).map((v) => ({ label: t(`sales.quotations.status.${v}`), value: v })), t("table.filterPlaceholder"))} header={t("purchasing.status")} style={{ width: "10rem" }} body={(r: QuotationSummary) => <Tag value={t(`sales.quotations.status.${r.status}`)} severity={SEVERITY[r.status]} />} />
          </DataGrid>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}

      <QuotationDialog id={viewId} onHide={() => setViewId(null)} />
    </div>
  );
}

function QuotationDialog({ id, onHide }: { id: string | null; onHide: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { data } = useQuotation(id);
  const reject = useQuotationAction(id ?? "", "reject");
  const cancel = useQuotationAction(id ?? "", "cancel");
  const [emailOpen, setEmailOpen] = useState(false);

  return (
    <Dialog header={data?.number ?? t("sales.quotations.title")} visible={id !== null} onHide={onHide} className="erp-dialog erp-dialog--wide" modal style={{ width: "min(64rem, 96vw)" }}>
      {!data ? (
        <PageSkeleton />
      ) : (
        <>
          <div className="erp-row-actions">
            <p style={{ margin: 0 }}>{localizedName({ name: data.customerName, nameAr: data.customerNameAr }, i18n.language)}</p>
            <div className="erp-page__header-actions">
              <Button label={t("sales.quotations.downloadPdf")} icon="pi pi-file-pdf" outlined onClick={() => void exportReport(`/v1/quotations/${data.id}/pdf`, { lang: i18n.language }, data.number, "pdf")} />
              <PermissionButton allowed={can("quotation:create")} label={t("sales.quotations.email.sendButton")} icon="pi pi-send" onClick={() => setEmailOpen(true)} />
            </div>
          </div>
          {data.notes ? <p>{data.notes}</p> : null}
          <DataGrid value={[...data.lines]} className="erp-table" size="small" showGridlines>
            <Column header={t("sales.description")} body={(l: SalesLineView) => l.description} />
            <Column header={t("purchasing.quantity")} align="right" body={(l: SalesLineView) => l.quantity} />
            <Column header={t("purchasing.unitPrice")} align="right" body={(l: SalesLineView) => formatMoney(l.unitPrice, data.currency)} />
            <Column header={t("purchasing.invoices.net")} align="right" body={(l: SalesLineView) => formatMoney(l.netAmount, data.currency)} />
            <Column header={t("purchasing.invoices.tax")} align="right" body={(l: SalesLineView) => formatMoney(l.taxAmount, data.currency)} />
          </DataGrid>
          <div className="erp-table-footer">
            <span>
              {t("purchasing.invoices.gross")}: <strong>{formatMoney(data.totalGross, data.currency)}</strong>
            </span>
          </div>
          {reject.isError || cancel.isError ? <p className="erp-auth-card__error">{t("sales.errors.generic")}</p> : null}
          {data.status === "OPEN" ? (
            <div className="erp-form__actions">
              <PermissionButton allowed={can("quotation:update")} label={t("sales.quotations.reject")} severity="danger" outlined loading={reject.isPending} onClick={() => reject.mutate(undefined, { onSuccess: onHide })} />
              <PermissionButton allowed={can("quotation:update")} label={t("sales.quotations.cancel")} severity="secondary" outlined loading={cancel.isPending} onClick={() => cancel.mutate(undefined, { onSuccess: onHide })} />
            </div>
          ) : data.salesOrderId ? (
            <div className="erp-form__actions">
              <Button label={t("sales.quotations.openOrder")} text onClick={() => void navigate(`/sales/orders/${data.salesOrderId}`)} />
            </div>
          ) : null}
        </>
      )}
      {data ? <QuotationEmailDialog quotation={data} visible={emailOpen} onHide={() => setEmailOpen(false)} /> : null}
    </Dialog>
  );
}

const DECIMAL_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Two ways to send: "Send now" renders the real email server-side and mails it directly once the
// user has previewed it at least once — nothing goes out before that. "Open in Gmail" is the
// manual fallback: it downloads the PDF (a compose URL cannot pre-attach a file) and opens Gmail
// with the recipient, subject and a plain-text body already filled in.
function QuotationEmailDialog({ quotation, visible, onHide }: { quotation: QuotationDetail; visible: boolean; onHide: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [language, setLanguage] = useState<"en" | "ar">(i18n.language.startsWith("ar") ? "ar" : "en");
  const [to, setTo] = useState(quotation.customerEmail ?? "");
  const preview = usePreviewQuotationEmail(quotation.id);
  const send = useSendQuotationEmail(quotation.id);

  const openDialog = (): void => {
    setTo(quotation.customerEmail ?? "");
    setLanguage(i18n.language.startsWith("ar") ? "ar" : "en");
    preview.reset();
    send.reset();
  };

  const toValid = DECIMAL_EMAIL.test(to);

  const doPreview = (): void => {
    preview.mutate(language);
  };

  const doSend = (): void => {
    if (!toValid) return;
    send.mutate({ to, language });
  };

  const openInGmail = (): void => {
    void exportReport(`/v1/quotations/${quotation.id}/pdf`, { lang: language }, quotation.number, "pdf");
    const customer = language === "ar" && quotation.customerNameAr ? quotation.customerNameAr : quotation.customerName;
    const subject = t("sales.quotations.email.gmailSubject", { number: quotation.number });
    const body = t("sales.quotations.email.gmailBody", { customer, number: quotation.number, total: formatMoney(quotation.totalGross, quotation.currency) });
    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog header={t("sales.quotations.email.title")} visible={visible} onHide={onHide} onShow={openDialog} className="erp-dialog erp-dialog--wide" modal style={{ width: "min(52rem, 96vw)" }}>
      <div className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="qeTo">{t("sales.quotations.email.recipient")}</label>
            <InputText id="qeTo" dir="ltr" value={to} onChange={(e) => { setTo(e.target.value); preview.reset(); send.reset(); }} className={to !== "" && !toValid ? "p-invalid" : ""} />
          </div>
          <div className="erp-field">
            <label htmlFor="qeLang">{t("sales.quotations.email.language")}</label>
            <Dropdown
              inputId="qeLang"
              value={language}
              onChange={(e) => { setLanguage(e.value as "en" | "ar"); preview.reset(); send.reset(); }}
              options={[
                { label: t("sales.quotations.email.languages.en"), value: "en" },
                { label: t("sales.quotations.email.languages.ar"), value: "ar" },
              ]}
            />
          </div>
        </div>

        <div className="erp-form__actions" style={{ justifyContent: "flex-start" }}>
          <Button type="button" label={t("sales.quotations.email.preview")} icon="pi pi-eye" outlined loading={preview.isPending} disabled={!toValid} onClick={doPreview} />
        </div>
        {preview.isError ? <p className="erp-auth-card__error">{t("sales.quotations.email.errors.generic")}</p> : null}
        {!preview.data ? <p className="erp-field__hint">{t("sales.quotations.email.previewHint")}</p> : null}

        {preview.data ? (
          <iframe
            title="email-preview"
            sandbox=""
            srcDoc={preview.data.html}
            style={{ width: "100%", height: "60vh", border: "1px solid var(--surface-border, #ddd)", borderRadius: "8px", background: "#fff" }}
          />
        ) : null}

        {send.isError ? <p className="erp-auth-card__error">{t("sales.quotations.email.errors.generic")}</p> : null}
        {send.isSuccess ? <p className="erp-field__hint">{t("sales.quotations.email.success")}</p> : null}

        <div className="erp-form__actions">
          <Button type="button" label={t("sales.quotations.email.openInGmail")} icon="pi pi-google" text disabled={!toValid} onClick={openInGmail} />
          <Button
            type="button"
            label={t("sales.quotations.email.sendNow")}
            icon="pi pi-send"
            disabled={!preview.data || send.isSuccess}
            loading={send.isPending}
            title={!preview.data ? t("sales.quotations.email.sendDisabledHint") : undefined}
            onClick={doSend}
          />
        </div>
        <p className="erp-field__hint">{t("sales.quotations.email.openInGmailHint")}</p>
      </div>
    </Dialog>
  );
}
