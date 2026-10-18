import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { Column } from "primereact/column";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { usePermissions } from "../../shared/auth/use-permissions";
import { apiClient } from "../../shared/api/client";
import { downloadBlob } from "../../shared/lib/download-file";
import { formatMoney } from "../../shared/lib/money";
import { DataGrid } from "../../shared/ui/DataGrid";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { usePayrollRun, type PayrollRunLine } from "./use-hr";

// The payroll run detail: totals, the full payslip table, and the Mudad/WPS wages-file download
// (packages/core/src/hr/wps-file.ts). There is no bilingual payslip PDF yet -- a REVIEW-level gap,
// listed in the project status report, not silently shipped as "done".
export function PayrollRunDetailPage(): React.JSX.Element {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const { can } = usePermissions();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data, isPending, isError, refetch } = usePayrollRun(id);

  const downloadWps = async (): Promise<void> => {
    const response = await apiClient.get<Blob>(`/v1/payroll-runs/${id}/wps-file`, { responseType: "blob" });
    downloadBlob(response.data, `${data?.number ?? id}-wages.txt`);
  };

  if (isPending) return <PageSkeleton />;
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
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title" dir="ltr">
            {data.number}
          </h1>
          <p className="erp-page__subtitle" dir="ltr">
            {data.runDate}
          </p>
        </div>
        <div className="erp-page__header-actions">
          <PermissionButton allowed={can("payroll_run:read")} label={t("hr.payrollRuns.downloadWps")} icon="pi pi-download" outlined onClick={() => void downloadWps()} />
        </div>
      </div>

      <div className="erp-table-footer">
        <span>
          {t("hr.payrollRuns.totalGross")}: <strong>{formatMoney(data.totalGross, currency)}</strong>
        </span>
        <span>
          {t("hr.payrollRuns.totalGosiEmployee")}: <strong>{formatMoney(data.totalGosiEmployee, currency)}</strong>
        </span>
        <span>
          {t("hr.payrollRuns.totalGosiEmployer")}: <strong>{formatMoney(data.totalGosiEmployer, currency)}</strong>
        </span>
        <span>
          {t("hr.payrollRuns.totalAdvanceDeduction")}: <strong>{formatMoney(data.totalAdvanceDeduction, currency)}</strong>
        </span>
        <span>
          {t("hr.payrollRuns.totalNet")}: <strong>{formatMoney(data.totalNet, currency)}</strong>
        </span>
      </div>

      <DataGrid searchable={false} value={[...data.lines]} className="erp-table" stripedRows showGridlines size="small">
        <Column header={t("hr.employees.name")} body={(row: PayrollRunLine) => <span className="coa-name">{row.employeeName}</span>} />
        <Column header={t("hr.employees.basicSalary")} align="right" body={(row: PayrollRunLine) => <span className="coa-amount">{formatMoney(row.basicSalary, currency)}</span>} />
        <Column header={t("hr.employees.housingAllowance")} align="right" body={(row: PayrollRunLine) => <span className="coa-amount">{formatMoney(row.housingAllowance, currency)}</span>} />
        <Column header={t("hr.payrollRuns.gross")} align="right" body={(row: PayrollRunLine) => <span className="coa-amount">{formatMoney(row.gross, currency)}</span>} />
        <Column header={t("hr.payrollRuns.gosiEmployee")} align="right" body={(row: PayrollRunLine) => <span className="coa-amount">{formatMoney(row.gosiEmployeeShare, currency)}</span>} />
        <Column header={t("hr.payrollRuns.advanceDeduction")} align="right" body={(row: PayrollRunLine) => <span className="coa-amount">{formatMoney(row.advanceDeduction, currency)}</span>} />
        <Column header={t("hr.payrollRuns.net")} align="right" body={(row: PayrollRunLine) => <span className="coa-amount"><strong>{formatMoney(row.net, currency)}</strong></span>} />
      </DataGrid>
    </div>
  );
}
