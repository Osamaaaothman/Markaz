import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { DataTable } from "primereact/datatable";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { formatMoney } from "../../shared/lib/money";
import { useComplianceInvoices, type ComplianceInvoiceRow } from "./use-compliance";
import { ZatcaStatusBadge } from "./ZatcaInvoicePanel";

export function ZatcaInvoicesTable(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ q: "", status: "", environment: "", documentType: "" });
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const result = useComplianceInvoices({ ...filters, cursor: cursors[cursors.length - 1] ?? null });
  const filter = (key: keyof typeof filters, value: string): void => { setFilters((previous) => ({ ...previous, [key]: value })); setCursors([null]); };
  const select = (key: "status" | "environment" | "documentType", values: readonly string[], prefix: string): React.JSX.Element => (
    <div className="erp-field">
      <label htmlFor={`zatca-filter-${key}`}>{t(`compliance.invoices.${key}`)}</label>
      <Dropdown inputId={`zatca-filter-${key}`} placeholder={t("compliance.invoices.all")} value={filters[key]} onChange={(event) => filter(key, event.value as string)} options={[{ value: "", label: t("compliance.invoices.all") }, ...values.map((value) => ({ value, label: t(`${prefix}.${value}`) }))]} />
    </div>
  );
  return <section className="erp-card">
    <h2 className="erp-card__title">{t("compliance.invoices.title")}</h2>
    <p className="erp-field__hint">{t("compliance.invoices.hint")}</p>
    <form className="compliance-invoice-filters" onSubmit={(event) => { event.preventDefault(); filter("q", search.trim()); }}>
      <div className="erp-field"><label htmlFor="zatca-search">{t("compliance.invoices.search")}</label><div className="compliance-invoice-search"><InputText id="zatca-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200} /><Button type="submit" aria-label={t("compliance.invoices.search")} icon="pi pi-search" /></div></div>
      {select("status", ["NOT_SUBMITTED", "SUBMITTING", "CLEARED", "REPORTED", "ACCEPTED_WITH_WARNINGS", "REJECTED", "FAILED_RETRYABLE"], "compliance.invoiceStatus")}
      {select("environment", ["sandbox", "simulation", "production"], "compliance.environment")}
      {select("documentType", ["INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"], "sales.invoices.types")}
    </form>
    {result.isError ? <p role="alert">{t("status.error")} <Button text label={t("actions.retry")} onClick={() => void result.refetch()} /></p> : <DataTable value={result.data?.data ?? []} loading={result.isPending} className="erp-table" stripedRows size="small" emptyMessage={t("status.empty")}>
      <Column header={t("purchasing.number")} body={(row: ComplianceInvoiceRow) => <Link to={`/sales/invoices/${row.salesInvoiceId}`}>{row.number}</Link>} />
      <Column header={t("sales.customer")} field="customerName" />
      <Column header={t("compliance.invoices.documentType")} body={(row: ComplianceInvoiceRow) => t(`sales.invoices.types.${row.documentType}`)} />
      <Column header={t("purchasing.invoices.invoiceDate")} body={(row: ComplianceInvoiceRow) => formatCalendarDate(row.invoiceDate, i18n.language)} />
      <Column header={t("purchasing.invoices.gross")} body={(row: ComplianceInvoiceRow) => formatMoney(row.totalGross, row.currency)} />
      <Column header={t("compliance.invoices.status")} body={(row: ComplianceInvoiceRow) => <ZatcaStatusBadge status={row.status} />} />
      <Column header={t("compliance.invoices.environment")} body={(row: ComplianceInvoiceRow) => <Tag value={t(`compliance.environment.${row.environment}`)} severity={row.environment === "production" ? "success" : "warning"} />} />
      <Column header={t("compliance.invoicePanel.attempts")} field="attempts" />
    </DataTable>}
    <div className="erp-row-actions">
      <Button label={t("compliance.invoices.previous")} outlined disabled={cursors.length === 1 || result.isFetching} onClick={() => setCursors((previous) => previous.slice(0, -1))} />
      <Button label={t("compliance.invoices.next")} outlined disabled={!result.data?.pageInfo.hasMore || result.isFetching} onClick={() => setCursors((previous) => [...previous, result.data?.pageInfo.nextCursor ?? null])} />
    </div>
  </section>;
}
