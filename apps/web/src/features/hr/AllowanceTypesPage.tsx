import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Checkbox } from "primereact/checkbox";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { localizedName } from "../../shared/lib/localized-name";
import { DataGrid } from "../../shared/ui/DataGrid";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import {
  allowanceErrorCode,
  useAddCommonAllowanceTypes,
  useAllowanceTypes,
  useCreateAllowanceType,
  useUpdateAllowanceType,
  type AllowanceTypeSummary,
} from "./use-allowance-types";

interface FormState {
  readonly id: string | null;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string;
  readonly isHousing: boolean;
  readonly inGosiBase: boolean;
  readonly inEosbBase: boolean;
}

const EMPTY: FormState = { id: null, code: "", name: "", nameAr: "", isHousing: false, inGosiBase: false, inEosbBase: true };

// The allowances the company pays. The two checkboxes decide what social insurance and the end-of-service gratuity are
// computed on; they apply to payroll from the next run (a posted run keeps what it used).
export function AllowanceTypesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const { data, isPending, isError, refetch } = useAllowanceTypes(true);
  const create = useCreateAllowanceType();
  const update = useUpdateAllowanceType();
  const addCommon = useAddCommonAllowanceTypes();
  const [form, setForm] = useState<FormState | null>(null);

  const editing = form?.id != null;
  const save = (): void => {
    if (!form) return;
    const done = { onSuccess: () => setForm(null) };
    if (editing) {
      update.mutate({ id: form.id, name: form.name.trim(), nameAr: form.nameAr.trim(), inGosiBase: form.inGosiBase, inEosbBase: form.inEosbBase }, done);
    } else {
      create.mutate({ code: form.code.trim(), name: form.name.trim(), ...(form.nameAr.trim() ? { nameAr: form.nameAr.trim() } : {}), isHousing: form.isHousing, inGosiBase: form.inGosiBase, inEosbBase: form.inEosbBase }, done);
    }
  };
  const failure = editing ? update.error : create.error;
  const yesNo = (value: boolean): React.JSX.Element => <Tag value={t(value ? "hr.allowanceTypes.yes" : "hr.allowanceTypes.no")} severity={value ? "success" : "secondary"} />;

  if (isPending) return <PageSkeleton />;
  if (isError) {
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
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("hr.allowanceTypes.title")}</h1>
          <p className="erp-page__subtitle">{t("hr.allowanceTypes.subtitle")}</p>
        </div>
        <div className="erp-row-actions">
          <PermissionButton allowed={can("allowance_type:create")} label={t("hr.allowanceTypes.addCommon")} icon="pi pi-list" outlined loading={addCommon.isPending} onClick={() => addCommon.mutate()} />
          <PermissionButton allowed={can("allowance_type:create")} label={t("hr.allowanceTypes.new")} icon="pi pi-plus" onClick={() => { create.reset(); setForm(EMPTY); }} />
        </div>
      </div>
      {addCommon.isSuccess ? <p className="erp-page__subtitle">{t("hr.allowanceTypes.addedCommon", { count: addCommon.data.added })}</p> : null}

      <DataGrid value={[...data]} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("hr.allowanceTypes.empty")}>
        <Column header={t("hr.allowanceTypes.code")} style={{ width: "11rem" }} body={(row: AllowanceTypeSummary) => <span className="coa-code" dir="ltr">{row.code}</span>} />
        <Column header={t("hr.allowanceTypes.name")} body={(row: AllowanceTypeSummary) => <span>{localizedName(row, i18n.language)} {row.isHousing ? <Tag value={t("hr.allowanceTypes.housing")} severity="info" /> : null}</span>} />
        <Column header={t("hr.allowanceTypes.inGosiBase")} style={{ width: "10rem" }} body={(row: AllowanceTypeSummary) => yesNo(row.inGosiBase)} />
        <Column header={t("hr.allowanceTypes.inEosbBase")} style={{ width: "10rem" }} body={(row: AllowanceTypeSummary) => yesNo(row.inEosbBase)} />
        <Column header={t("hr.allowanceTypes.status")} style={{ width: "8rem" }} body={(row: AllowanceTypeSummary) => <Tag value={t(row.isActive ? "hr.allowanceTypes.active" : "hr.allowanceTypes.stopped")} severity={row.isActive ? "success" : "secondary"} />} />
        <Column
          header=""
          style={{ width: "13rem" }}
          body={(row: AllowanceTypeSummary) => (
            <div className="erp-row-actions">
              <PermissionButton
                allowed={can("allowance_type:update")}
                label={t("actions.edit")}
                size="small"
                text
                onClick={() => { update.reset(); setForm({ id: row.id, code: row.code, name: row.name, nameAr: row.nameAr ?? "", isHousing: row.isHousing, inGosiBase: row.inGosiBase, inEosbBase: row.inEosbBase }); }}
              />
              <PermissionButton
                allowed={can("allowance_type:update")}
                label={t(row.isActive ? "hr.allowanceTypes.stop" : "hr.allowanceTypes.activate")}
                size="small"
                text
                severity={row.isActive ? "danger" : "secondary"}
                onClick={() => update.mutate({ id: row.id, isActive: !row.isActive })}
              />
            </div>
          )}
        />
      </DataGrid>
      {update.isError && form === null ? <p className="erp-auth-card__error">{t(`hr.allowanceTypes.errors.${allowanceErrorCode(update.error) ?? "generic"}`, { defaultValue: t("hr.allowanceTypes.errors.generic") })}</p> : null}

      <Dialog header={t(editing ? "hr.allowanceTypes.edit" : "hr.allowanceTypes.new")} visible={form !== null} onHide={() => setForm(null)} className="erp-dialog" modal style={{ width: "min(34rem, 96vw)" }}>
        {form ? (
          <div className="erp-form">
            <div className="erp-field">
              <label htmlFor="atCode">{t("hr.allowanceTypes.code")}</label>
              <InputText id="atCode" dir="ltr" value={form.code} disabled={editing} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div className="erp-form__row">
              <div className="erp-field">
                <label htmlFor="atName">{t("hr.allowanceTypes.name")}</label>
                <InputText id="atName" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="erp-field">
                <label htmlFor="atNameAr">{t("hr.allowanceTypes.nameAr")}</label>
                <InputText id="atNameAr" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
              </div>
            </div>
            {!editing ? (
              <label className="coa-levels" htmlFor="atHousing">
                <Checkbox inputId="atHousing" checked={form.isHousing} onChange={(e) => setForm({ ...form, isHousing: Boolean(e.checked) })} />
                <span className="coa-levels__label">{t("hr.allowanceTypes.isHousingHint")}</span>
              </label>
            ) : null}
            <label className="coa-levels" htmlFor="atGosi">
              <Checkbox inputId="atGosi" checked={form.inGosiBase} onChange={(e) => setForm({ ...form, inGosiBase: Boolean(e.checked) })} />
              <span className="coa-levels__label">{t("hr.allowanceTypes.inGosiBaseHint")}</span>
            </label>
            <label className="coa-levels" htmlFor="atEosb">
              <Checkbox inputId="atEosb" checked={form.inEosbBase} onChange={(e) => setForm({ ...form, inEosbBase: Boolean(e.checked) })} />
              <span className="coa-levels__label">{t("hr.allowanceTypes.inEosbBaseHint")}</span>
            </label>
            {failure ? <p className="erp-auth-card__error">{t(`hr.allowanceTypes.errors.${allowanceErrorCode(failure) ?? "generic"}`, { defaultValue: t("hr.allowanceTypes.errors.generic") })}</p> : null}
            <div className="erp-form__actions">
              <Button type="button" label={t("actions.cancel")} text onClick={() => setForm(null)} />
              <Button type="button" label={t("actions.save")} disabled={form.name.trim() === "" || (!editing && form.code.trim() === "")} loading={create.isPending || update.isPending} onClick={save} />
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
