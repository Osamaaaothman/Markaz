import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Checkbox } from "primereact/checkbox";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { z } from "zod";
import { usePermissions } from "../../shared/auth/use-permissions";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { formatMoney } from "../../shared/lib/money";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { useDebouncedValue } from "../../shared/lib/use-debounced-value";
import { CopyId } from "../../shared/ui/CopyId";
import { CreatedDialog, type CreatedInfo } from "../../shared/ui/CreatedDialog";
import { DataGrid } from "../../shared/ui/DataGrid";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useCreateEmployee, useEmployees, type EmployeeSummary } from "./use-hr";

const EMPLOYEE_SCHEMA = z.object({
  name: z.string().trim().min(1, "required"),
  nameAr: z.string(),
  nationalId: z.string().trim().min(1, "required"),
  isSaudi: z.boolean(),
  bankIban: z.string().trim().min(1, "required"),
  bankName: z.string(),
  hireDate: z.date(),
  basicSalary: z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, "invalid").refine((v) => Number(v) > 0, "required"),
  housingAllowance: z.string().regex(/^\d{0,15}(\.\d{1,4})?$/, "invalid"),
  otherAllowances: z.string().regex(/^\d{0,15}(\.\d{1,4})?$/, "invalid"),
});
type EmployeeFormValues = z.infer<typeof EMPLOYEE_SCHEMA>;
const EMPTY_FORM: EmployeeFormValues = { name: "", nameAr: "", nationalId: "", isSaudi: true, bankIban: "", bankName: "", hireDate: new Date(), basicSalary: "", housingAllowance: "0", otherAllowances: "0" };

export function EmployeesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [created, setCreated] = useState<CreatedInfo | null>(null);

  const debouncedQuery = useDebouncedValue(query);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useEmployees({ q: debouncedQuery, includeInactive });
  const employees = data?.pages.flatMap((page) => page.data) ?? [];
  const createEmployee = useCreateEmployee();

  const { control, register, handleSubmit, reset, formState: { errors } } = useForm<EmployeeFormValues>({ resolver: zodResolver(EMPLOYEE_SCHEMA), defaultValues: EMPTY_FORM });

  useEffect(() => {
    if (!dialogOpen) return;
    createEmployee.reset();
    reset(EMPTY_FORM);
    // Deliberately keyed on `dialogOpen` alone — reset()/createEmployee.reset() are stable identities.
  }, [dialogOpen]);

  const onSubmit = handleSubmit((values) => {
    createEmployee.mutate(
      {
        name: values.name,
        ...(values.nameAr.trim() ? { nameAr: values.nameAr.trim() } : {}),
        nationalId: values.nationalId,
        isSaudi: values.isSaudi,
        bankIban: values.bankIban,
        ...(values.bankName.trim() ? { bankName: values.bankName.trim() } : {}),
        hireDate: toDateOnlyIsoString(values.hireDate),
        basicSalary: values.basicSalary,
        ...(values.housingAllowance.trim() ? { housingAllowance: values.housingAllowance.trim() } : {}),
        ...(values.otherAllowances.trim() ? { otherAllowances: values.otherAllowances.trim() } : {}),
      },
      {
        onSuccess: (saved) => {
          setDialogOpen(false);
          setCreated({
            title: t("hr.employees.add"),
            headline: saved.ref,
            rows: [
              { label: t("hr.employees.name"), value: saved.name },
              { label: t("hr.employees.nationality"), value: saved.isSaudi ? t("hr.employees.saudi") : t("hr.employees.expat") },
              { label: t("created.amount"), value: formatMoney(saved.basicSalary, currency), ltr: true },
            ],
          });
        },
      },
    );
  });

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("hr.employees.title")}</h1>
          <p className="erp-page__subtitle">{t("hr.employees.subtitle")}</p>
        </div>
        <PermissionButton allowed={can("employee:create")} label={t("hr.employees.add")} icon="pi pi-plus" onClick={() => setDialogOpen(true)} />
      </div>

      <div className="coa-toolbar">
        <div className="coa-search">
          <InputText value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("hr.employees.searchPlaceholder")} aria-label={t("hr.employees.searchPlaceholder")} />
        </div>
        <label className="coa-levels" htmlFor="employeesInactive">
          <InputSwitch inputId="employeesInactive" checked={includeInactive} onChange={(e) => setIncludeInactive(Boolean(e.value))} />
          <span className="coa-levels__label">{t("hr.employees.showInactive")}</span>
        </label>
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
          <DataGrid searchable={false} value={employees} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")} onRowClick={(e) => void navigate(`/hr/employees/${(e.data as EmployeeSummary).id}`)} selectionMode="single">
            <Column header={t("hr.employees.name")} body={(row: EmployeeSummary) => <span className="coa-name">{i18n.language === "ar" && row.nameAr ? row.nameAr : row.name}</span>} />
            <Column header={t("hr.employees.nationality")} style={{ width: "8rem" }} body={(row: EmployeeSummary) => (row.isSaudi ? t("hr.employees.saudi") : t("hr.employees.expat"))} />
            <Column header={t("hr.employees.basicSalary")} style={{ width: "10rem" }} body={(row: EmployeeSummary) => <span className="coa-amount">{formatMoney(row.basicSalary, currency)}</span>} />
            <Column header={t("inventory.id")} style={{ width: "8rem" }} body={(row: EmployeeSummary) => <CopyId value={row.ref} uuid={row.id} />} />
            <Column
              header={t("inventory.warehouses.status")}
              style={{ width: "8rem" }}
              body={(row: EmployeeSummary) => <Tag value={row.isActive ? t("inventory.warehouses.active") : t("inventory.warehouses.inactive")} severity={row.isActive ? "success" : "warning"} />}
            />
          </DataGrid>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}

      <Dialog header={t("hr.employees.add")} visible={dialogOpen} onHide={() => setDialogOpen(false)} className="erp-dialog" modal style={{ width: "min(40rem, 96vw)" }}>
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
          <div className="erp-form__row">
            <div className="erp-field">
              <label htmlFor="empName">{t("hr.employees.name")}</label>
              <InputText id="empName" {...register("name")} className={errors.name ? "p-invalid" : ""} />
            </div>
            <div className="erp-field">
              <label htmlFor="empNameAr">{t("created.nameAr")}</label>
              <InputText id="empNameAr" dir="rtl" {...register("nameAr")} />
            </div>
          </div>
          <div className="erp-form__row">
            <div className="erp-field">
              <label htmlFor="empNationalId">{t("hr.employees.nationalId")}</label>
              <InputText id="empNationalId" dir="ltr" {...register("nationalId")} className={errors.nationalId ? "p-invalid" : ""} />
            </div>
            <div className="erp-field">
              <label htmlFor="empHireDate">{t("hr.employees.hireDate")}</label>
              <Controller control={control} name="hireDate" render={({ field }) => <Calendar inputId="empHireDate" value={field.value} onChange={(e) => field.onChange(e.value)} dateFormat="yy-mm-dd" />} />
            </div>
          </div>
          <div className="erp-field">
            <Controller
              control={control}
              name="isSaudi"
              render={({ field }) => (
                <label className="coa-levels" htmlFor="empIsSaudi">
                  <Checkbox inputId="empIsSaudi" checked={field.value} onChange={(e) => field.onChange(Boolean(e.checked))} />
                  <span className="coa-levels__label">{t("hr.employees.isSaudi")}</span>
                </label>
              )}
            />
          </div>
          <div className="erp-form__row">
            <div className="erp-field">
              <label htmlFor="empIban">{t("hr.employees.bankIban")}</label>
              <InputText id="empIban" dir="ltr" {...register("bankIban")} className={errors.bankIban ? "p-invalid" : ""} />
            </div>
            <div className="erp-field">
              <label htmlFor="empBankName">{t("hr.employees.bankName")}</label>
              <InputText id="empBankName" {...register("bankName")} />
            </div>
          </div>
          <div className="erp-form__row">
            <div className="erp-field">
              <label htmlFor="empBasic">{t("hr.employees.basicSalary")}</label>
              <InputText id="empBasic" dir="ltr" {...register("basicSalary")} className={errors.basicSalary ? "p-invalid" : ""} />
            </div>
            <div className="erp-field">
              <label htmlFor="empHousing">{t("hr.employees.housingAllowance")}</label>
              <InputText id="empHousing" dir="ltr" {...register("housingAllowance")} />
            </div>
            <div className="erp-field">
              <label htmlFor="empOther">{t("hr.employees.otherAllowances")}</label>
              <InputText id="empOther" dir="ltr" {...register("otherAllowances")} />
            </div>
          </div>
          {createEmployee.isError ? <p className="erp-auth-card__error">{t("hr.employees.createError")}</p> : null}
          <div className="erp-form__actions">
            <Button type="button" label={t("actions.cancel")} text onClick={() => setDialogOpen(false)} />
            <Button type="submit" label={t("hr.employees.add")} loading={createEmployee.isPending} />
          </div>
        </form>
      </Dialog>

      <CreatedDialog info={created} onHide={() => setCreated(null)} />
    </div>
  );
}
