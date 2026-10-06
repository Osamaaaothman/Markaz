import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { localizedName } from "../../shared/lib/localized-name";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useAddSaudiTaxCodes, useCreateTaxCode, useTaxCodes, useUpdateTaxCode, type TaxCodeSummary, type TaxTreatment } from "./use-invoicing";

const TREATMENTS: readonly TaxTreatment[] = ["STANDARD", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"];

const schema = z
  .object({
    code: z.string().trim().min(1, "required").max(20, "codeFormat"),
    name: z.string().trim().min(1, "required"),
    nameAr: z.string(),
    treatment: z.enum(["STANDARD", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"]),
    rate: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, "positiveAmount"),
  })
  .refine((v) => v.treatment === "STANDARD" || Number(v.rate) === 0, { path: ["rate"], message: "positiveAmount" })
  .refine((v) => Number(v.rate) <= 100, { path: ["rate"], message: "positiveAmount" });
type FormValues = z.infer<typeof schema>;

export function TaxCodesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data, isPending, isError, refetch } = useTaxCodes(includeInactive);
  const addDefaults = useAddSaudiTaxCodes();
  const update = useUpdateTaxCode();

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("purchasing.tax.title")}</h1>
          <p className="erp-page__subtitle">{t("purchasing.tax.subtitle")}</p>
        </div>
        <div className="erp-page__header-actions">
          <PermissionButton allowed={can("tax_code:create")} label={t("purchasing.tax.addDefaults")} icon="pi pi-flag" outlined loading={addDefaults.isPending} onClick={() => addDefaults.mutate()} />
          <PermissionButton allowed={can("tax_code:create")} label={t("purchasing.tax.add")} icon="pi pi-plus" onClick={() => setDialogOpen(true)} />
        </div>
      </div>

      <p className="erp-field__hint">{t("purchasing.tax.defaultsHint")}</p>

      <div className="coa-toolbar">
        <label className="coa-levels" htmlFor="taxInactive">
          <InputSwitch inputId="taxInactive" checked={includeInactive} onChange={(e) => setIncludeInactive(Boolean(e.value))} />
          <span className="coa-levels__label">{t("inventory.items.showInactive")}</span>
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
        <DataTable value={data} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("purchasing.tax.empty")}>
          <Column header={t("inventory.items.code")} style={{ width: "10rem" }} body={(row: TaxCodeSummary) => <span className="coa-code">{row.code}</span>} />
          <Column header={t("inventory.items.name")} body={(row: TaxCodeSummary) => localizedName(row, i18n.language)} />
          <Column header={t("purchasing.tax.treatment")} body={(row: TaxCodeSummary) => t(`purchasing.tax.treatments.${row.treatment}`)} />
          <Column header={t("purchasing.tax.rate")} align="right" style={{ width: "8rem" }} body={(row: TaxCodeSummary) => `${Number(row.rate)}%`} />
          <Column
            header={t("inventory.items.status")}
            style={{ width: "8rem" }}
            body={(row: TaxCodeSummary) => <Tag value={row.isActive ? t("inventory.items.active") : t("inventory.items.inactive")} severity={row.isActive ? "success" : "warning"} />}
          />
          <Column
            header=""
            style={{ width: "9rem" }}
            body={(row: TaxCodeSummary) => (
              <PermissionButton
                allowed={can("tax_code:update")}
                label={row.isActive ? t("purchasing.tax.deactivate") : t("purchasing.tax.activate")}
                size="small"
                text
                severity="secondary"
                onClick={() => update.mutate({ id: row.id, isActive: !row.isActive })}
              />
            )}
          />
        </DataTable>
      )}
      {addDefaults.isError || update.isError ? <p className="erp-auth-card__error">{t("purchasing.tax.saveError")}</p> : null}

      <TaxCodeDialog visible={dialogOpen} onHide={() => setDialogOpen(false)} />
    </div>
  );
}

function TaxCodeDialog({ visible, onHide }: { visible: boolean; onHide: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const create = useCreateTaxCode();
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { code: "", name: "", nameAr: "", treatment: "STANDARD", rate: "15" } });
  const treatment = watch("treatment");

  const onSubmit = handleSubmit((values) => {
    create.mutate(
      {
        code: values.code,
        name: values.name,
        ...(values.nameAr.trim() ? { nameAr: values.nameAr.trim() } : {}),
        rate: values.treatment === "STANDARD" ? values.rate : "0",
        treatment: values.treatment,
      },
      {
        onSuccess: () => {
          reset();
          onHide();
        },
      },
    );
  });
  const isConflict = (create.error as { response?: { status?: number } } | null)?.response?.status === 409;

  return (
    <Dialog header={t("purchasing.tax.add")} visible={visible} onHide={onHide} className="erp-dialog" modal style={{ width: "min(32rem, 96vw)" }}>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
        <div className="erp-field">
          <label htmlFor="taxCode">{t("inventory.items.code")}</label>
          <InputText id="taxCode" dir="ltr" {...register("code")} className={errors.code ? "p-invalid" : ""} />
        </div>
        <div className="erp-field">
          <label htmlFor="taxName">{t("inventory.items.name")}</label>
          <InputText id="taxName" {...register("name")} className={errors.name ? "p-invalid" : ""} />
        </div>
        <div className="erp-field">
          <label htmlFor="taxNameAr">{t("inventory.items.nameAr")}</label>
          <InputText id="taxNameAr" {...register("nameAr")} />
        </div>
        <div className="erp-field">
          <label htmlFor="taxTreatment">{t("purchasing.tax.treatment")}</label>
          <Controller
            control={control}
            name="treatment"
            render={({ field }) => (
              <Dropdown inputId="taxTreatment" value={field.value} onChange={(e) => field.onChange(e.value)} options={TREATMENTS.map((x) => ({ label: t(`purchasing.tax.treatments.${x}`), value: x }))} />
            )}
          />
        </div>
        {treatment === "STANDARD" ? (
          <div className="erp-field">
            <label htmlFor="taxRate">{t("purchasing.tax.rate")} (%)</label>
            <InputText id="taxRate" dir="ltr" {...register("rate")} className={errors.rate ? "p-invalid" : ""} />
          </div>
        ) : null}
        {isConflict ? <p className="erp-auth-card__error">{t("purchasing.tax.duplicate")}</p> : create.isError ? <p className="erp-auth-card__error">{t("purchasing.tax.saveError")}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
          <Button type="submit" label={t("actions.save")} loading={create.isPending} />
        </div>
      </form>
    </Dialog>
  );
}
