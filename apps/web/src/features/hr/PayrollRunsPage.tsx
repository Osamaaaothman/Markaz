import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { InputNumber } from "primereact/inputnumber";
import { z } from "zod";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatMoney } from "../../shared/lib/money";
import { DataGrid } from "../../shared/ui/DataGrid";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useCreatePayrollRun, usePayrollRuns, type PayrollRunSummary } from "./use-hr";

const RUN_SCHEMA = z.object({ periodYear: z.number().min(2020).max(2100), periodMonth: z.number().min(1).max(12) });
type RunFormValues = z.infer<typeof RUN_SCHEMA>;

const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

export function PayrollRunsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isPending, isError, refetch } = usePayrollRuns();
  const createRun = useCreatePayrollRun();

  const now = new Date();
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<RunFormValues>({
    resolver: zodResolver(RUN_SCHEMA),
    defaultValues: { periodYear: now.getUTCFullYear(), periodMonth: now.getUTCMonth() + 1 },
  });
  const periodYear = watch("periodYear");
  const periodMonth = watch("periodMonth");

  const onSubmit = handleSubmit((values) => {
    // The run date is the last day of the chosen period -- GOSI's bracket and period-eligibility checks read it.
    const runDate = new Date(Date.UTC(values.periodYear, values.periodMonth, 0));
    createRun.mutate(
      { periodYear: values.periodYear, periodMonth: values.periodMonth, runDate: runDate.toISOString().slice(0, 10) },
      { onSuccess: (saved) => void navigate(`/hr/payroll-runs/${saved.id}`) },
    );
  });

  const errCode = (createRun.error as { response?: { data?: { error?: { code?: string } } } } | null)?.response?.data?.error?.code;

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("hr.payrollRuns.title")}</h1>
          <p className="erp-page__subtitle">{t("hr.payrollRuns.subtitle")}</p>
        </div>
        <PermissionButton allowed={can("payroll_run:create")} label={t("hr.payrollRuns.run")} icon="pi pi-plus" onClick={() => setDialogOpen(true)} />
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
        <DataGrid searchable={false} value={[...data]} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")} onRowClick={(e) => void navigate(`/hr/payroll-runs/${(e.data as PayrollRunSummary).id}`)} selectionMode="single">
          <Column field="number" header={t("hr.payrollRuns.number")} style={{ width: "10rem" }} body={(row: PayrollRunSummary) => <span dir="ltr">{row.number}</span>} />
          <Column header={t("hr.payrollRuns.period")} body={(row: PayrollRunSummary) => <span>{t(`hr.payrollRuns.months.${MONTH_KEYS[row.periodMonth - 1]}`)} {row.periodYear}</span>} />
          <Column header={t("created.date")} style={{ width: "8rem" }} body={(row: PayrollRunSummary) => <span dir="ltr">{row.runDate}</span>} />
          <Column header={t("hr.payrollRuns.totalNet")} style={{ width: "10rem" }} body={(row: PayrollRunSummary) => <span className="coa-amount">{formatMoney(row.totalNet, row.currency)}</span>} />
        </DataGrid>
      )}

      <Dialog header={t("hr.payrollRuns.run")} visible={dialogOpen} onHide={() => setDialogOpen(false)} className="erp-dialog" modal style={{ width: "min(26rem, 96vw)" }}>
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
          <div className="erp-form__row">
            <div className="erp-field">
              <label htmlFor="runYear">{t("hr.payrollRuns.year")}</label>
              <InputNumber inputId="runYear" value={periodYear} onValueChange={(e) => setValue("periodYear", e.value ?? now.getUTCFullYear())} useGrouping={false} className={errors.periodYear ? "p-invalid" : ""} />
              <input type="hidden" {...register("periodYear", { valueAsNumber: true })} />
            </div>
            <div className="erp-field">
              <label htmlFor="runMonth">{t("hr.payrollRuns.month")}</label>
              <InputNumber inputId="runMonth" value={periodMonth} onValueChange={(e) => setValue("periodMonth", e.value ?? 1)} min={1} max={12} useGrouping={false} className={errors.periodMonth ? "p-invalid" : ""} />
              <input type="hidden" {...register("periodMonth", { valueAsNumber: true })} />
            </div>
          </div>
          {createRun.isError ? (
            <p className="erp-auth-card__error">{errCode === "PERIOD_ALREADY_RUN" ? t("hr.payrollRuns.errors.alreadyRun") : errCode === "NO_ACTIVE_EMPLOYEES" ? t("hr.payrollRuns.errors.noEmployees") : t("hr.payrollRuns.errors.generic")}</p>
          ) : null}
          <div className="erp-form__actions">
            <Button type="button" label={t("actions.cancel")} text onClick={() => setDialogOpen(false)} />
            <Button type="submit" label={t("hr.payrollRuns.run")} loading={createRun.isPending} />
          </div>
        </form>
      </Dialog>
    </div>
  );
}
