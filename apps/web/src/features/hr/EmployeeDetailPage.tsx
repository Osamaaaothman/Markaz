import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { z } from "zod";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { usePermissions } from "../../shared/auth/use-permissions";
import { localizedName } from "../../shared/lib/localized-name";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { formatMoney } from "../../shared/lib/money";
import { useChartOfAccounts } from "../accounting/use-chart-of-accounts";
import { CreatedDialog, type CreatedInfo } from "../../shared/ui/CreatedDialog";
import { DataGrid } from "../../shared/ui/DataGrid";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useEmployee, useGrantSalaryAdvance, useSalaryAdvances, useSettleEndOfService, useUpdateEmployee, type SalaryAdvanceSummary } from "./use-hr";

const ADVANCE_SCHEMA = z.object({
  grantDate: z.date(),
  amount: z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, "invalid").refine((v) => Number(v) > 0, "required"),
  installmentAmount: z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, "invalid").refine((v) => Number(v) > 0, "required"),
  cashAccountId: z.string().min(1, "required"),
});
type AdvanceFormValues = z.infer<typeof ADVANCE_SCHEMA>;

const EOSB_SCHEMA = z.object({ terminationDate: z.date(), reason: z.enum(["RESIGNATION", "TERMINATION", "OTHER"]) });
type EosbFormValues = z.infer<typeof EOSB_SCHEMA>;

export function EmployeeDetailPage(): React.JSX.Element {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: employee, isPending, isError, refetch } = useEmployee(id);
  const { data: advances } = useSalaryAdvances(id);
  const { data: accounts } = useChartOfAccounts();
  const updateEmployee = useUpdateEmployee(id);

  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [eosbOpen, setEosbOpen] = useState(false);
  const [created, setCreated] = useState<CreatedInfo | null>(null);

  const grantAdvance = useGrantSalaryAdvance();
  const settleEosb = useSettleEndOfService();

  const {
    control: advanceControl,
    register: registerAdvance,
    handleSubmit: handleAdvanceSubmit,
    reset: resetAdvance,
    formState: { errors: advanceErrors },
  } = useForm<AdvanceFormValues>({ resolver: zodResolver(ADVANCE_SCHEMA), defaultValues: { grantDate: new Date(), amount: "", installmentAmount: "", cashAccountId: "" } });

  const {
    control: eosbControl,
    handleSubmit: handleEosbSubmit,
    formState: { errors: eosbErrors },
  } = useForm<EosbFormValues>({ resolver: zodResolver(EOSB_SCHEMA), defaultValues: { terminationDate: new Date(), reason: "RESIGNATION" } });

  const onGrantAdvance = handleAdvanceSubmit((values) => {
    grantAdvance.mutate(
      { employeeId: id, grantDate: toDateOnlyIsoString(values.grantDate), amount: values.amount, installmentAmount: values.installmentAmount, cashAccountId: values.cashAccountId },
      {
        onSuccess: (saved) => {
          setAdvanceOpen(false);
          resetAdvance();
          setCreated({ title: t("hr.advances.grant"), headline: saved.number, rows: [{ label: t("created.amount"), value: formatMoney(values.amount, currency), ltr: true }] });
        },
      },
    );
  });

  const onSettleEosb = handleEosbSubmit((values) => {
    settleEosb.mutate(
      { employeeId: id, terminationDate: toDateOnlyIsoString(values.terminationDate), reason: values.reason },
      {
        onSuccess: (result) => {
          setEosbOpen(false);
          setCreated({
            title: t("hr.eosb.settle"),
            headline: result.number,
            rows: [
              { label: t("hr.eosb.years"), value: result.yearsOfService, ltr: true },
              { label: t("hr.eosb.fraction"), value: result.entitlementFraction, ltr: true },
              { label: t("created.amount"), value: formatMoney(result.netEntitlement, currency), ltr: true },
            ],
          });
        },
      },
    );
  });

  if (isPending) return <PageSkeleton />;
  if (isError || !employee) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }

  const postableAssets = (accounts ?? []).filter((a) => a.isPostable && a.type === "ASSET");

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{i18n.language === "ar" && employee.nameAr ? employee.nameAr : employee.name}</h1>
          <p className="erp-page__subtitle" dir="ltr">
            {employee.ref}
          </p>
        </div>
        <div className="erp-page__header-actions">
          <Tag value={employee.isActive ? t("inventory.warehouses.active") : t("inventory.warehouses.inactive")} severity={employee.isActive ? "success" : "warning"} />
          <PermissionButton allowed={can("salary_advance:create") && employee.isActive} label={t("hr.advances.grant")} icon="pi pi-money-bill" outlined onClick={() => setAdvanceOpen(true)} />
          <PermissionButton allowed={can("end_of_service:create") && employee.isActive} label={t("hr.eosb.settle")} icon="pi pi-sign-out" severity="danger" outlined onClick={() => setEosbOpen(true)} />
        </div>
      </div>

      <section className="erp-card">
        <h2 className="erp-card__title">{t("hr.employees.details")}</h2>
        <dl className="mk-facts">
          <div>
            <dt>{t("hr.employees.nationalId")}</dt>
            <dd dir="ltr">{employee.nationalId}</dd>
          </div>
          <div>
            <dt>{t("hr.employees.nationality")}</dt>
            <dd>{employee.isSaudi ? t("hr.employees.saudi") : t("hr.employees.expat")}</dd>
          </div>
          <div>
            <dt>{t("hr.employees.bankIban")}</dt>
            <dd dir="ltr">{employee.bankIban}</dd>
          </div>
          <div>
            <dt>{t("hr.employees.hireDate")}</dt>
            <dd dir="ltr">{employee.hireDate}</dd>
          </div>
          <div>
            <dt>{t("hr.employees.basicSalary")}</dt>
            <dd dir="ltr">{formatMoney(employee.basicSalary, currency)}</dd>
          </div>
          <div>
            <dt>{t("hr.employees.housingAllowance")}</dt>
            <dd dir="ltr">{formatMoney(employee.housingAllowance, currency)}</dd>
          </div>
        </dl>
        {employee.isActive ? (
          <PermissionButton
            allowed={can("employee:update")}
            label={t("hr.employees.deactivate")}
            icon="pi pi-ban"
            text
            severity="secondary"
            onClick={() => updateEmployee.mutate({ isActive: false })}
            loading={updateEmployee.isPending}
          />
        ) : null}
      </section>

      <section className="erp-card">
        <h2 className="erp-card__title">{t("hr.advances.title")}</h2>
        {advances && advances.length > 0 ? (
          <DataGrid searchable={false} value={[...advances]} className="erp-table">
            <Column field="number" header={t("hr.payrollRuns.number")} body={(row: SalaryAdvanceSummary) => <span dir="ltr">{row.number}</span>} />
            <Column header={t("created.date")} body={(row: SalaryAdvanceSummary) => <span dir="ltr">{row.grantDate}</span>} />
            <Column header={t("created.amount")} align="right" body={(row: SalaryAdvanceSummary) => <span className="coa-amount">{formatMoney(row.amount, currency)}</span>} />
            <Column header={t("hr.advances.remaining")} align="right" body={(row: SalaryAdvanceSummary) => <span className="coa-amount">{formatMoney(row.remaining, currency)}</span>} />
          </DataGrid>
        ) : (
          <p className="erp-card__empty">{t("status.empty")}</p>
        )}
      </section>

      <Dialog header={t("hr.advances.grant")} visible={advanceOpen} onHide={() => setAdvanceOpen(false)} className="erp-dialog" modal style={{ width: "min(28rem, 96vw)" }}>
        <form onSubmit={(e) => void onGrantAdvance(e)} noValidate className="erp-form">
          <div className="erp-field">
            <label htmlFor="advDate">{t("created.date")}</label>
            <Controller control={advanceControl} name="grantDate" render={({ field }) => <Calendar inputId="advDate" value={field.value} onChange={(e) => field.onChange(e.value)} dateFormat="yy-mm-dd" />} />
          </div>
          <div className="erp-form__row">
            <div className="erp-field">
              <label htmlFor="advAmount">{t("created.amount")}</label>
              <InputText id="advAmount" dir="ltr" {...registerAdvance("amount")} className={advanceErrors.amount ? "p-invalid" : ""} />
            </div>
            <div className="erp-field">
              <label htmlFor="advInstallment">{t("hr.advances.installment")}</label>
              <InputText id="advInstallment" dir="ltr" {...registerAdvance("installmentAmount")} className={advanceErrors.installmentAmount ? "p-invalid" : ""} />
            </div>
          </div>
          <div className="erp-field">
            <label htmlFor="advCash">{t("payments.bankAccount")}</label>
            <Controller
              control={advanceControl}
              name="cashAccountId"
              render={({ field }) => (
                <Dropdown
                  inputId="advCash"
                  value={field.value || null}
                  onChange={(e) => field.onChange((e.value as string | null) ?? "")}
                  options={postableAssets.map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id }))}
                  filter
                  placeholder={t("payments.pickBank")}
                  className={advanceErrors.cashAccountId ? "p-invalid" : ""}
                />
              )}
            />
          </div>
          <div className="erp-form__actions">
            <Button type="button" label={t("actions.cancel")} text onClick={() => setAdvanceOpen(false)} />
            <Button type="submit" label={t("hr.advances.grant")} loading={grantAdvance.isPending} />
          </div>
        </form>
      </Dialog>

      <Dialog header={t("hr.eosb.settle")} visible={eosbOpen} onHide={() => setEosbOpen(false)} className="erp-dialog" modal style={{ width: "min(26rem, 96vw)" }}>
        <form onSubmit={(e) => void onSettleEosb(e)} noValidate className="erp-form">
          <div className="erp-field">
            <label htmlFor="eosbDate">{t("hr.eosb.terminationDate")}</label>
            <Controller control={eosbControl} name="terminationDate" render={({ field }) => <Calendar inputId="eosbDate" value={field.value} onChange={(e) => field.onChange(e.value)} dateFormat="yy-mm-dd" />} />
          </div>
          <div className="erp-field">
            <label htmlFor="eosbReason">{t("hr.eosb.reason")}</label>
            <Controller
              control={eosbControl}
              name="reason"
              render={({ field }) => (
                <Dropdown
                  inputId="eosbReason"
                  value={field.value}
                  onChange={(e) => field.onChange(e.value as string)}
                  options={[
                    { label: t("hr.eosb.reasons.RESIGNATION"), value: "RESIGNATION" },
                    { label: t("hr.eosb.reasons.TERMINATION"), value: "TERMINATION" },
                    { label: t("hr.eosb.reasons.OTHER"), value: "OTHER" },
                  ]}
                />
              )}
            />
          </div>
          {eosbErrors.terminationDate ? <small className="erp-field__error">{t("purchasing.requests.warehouseRequired")}</small> : null}
          <div className="erp-form__actions">
            <Button type="button" label={t("actions.cancel")} text onClick={() => setEosbOpen(false)} />
            <Button type="submit" label={t("hr.eosb.settle")} severity="danger" loading={settleEosb.isPending} />
          </div>
        </form>
      </Dialog>

      <CreatedDialog info={created} onHide={() => { setCreated(null); void navigate("/hr/employees"); }} />
    </div>
  );
}
