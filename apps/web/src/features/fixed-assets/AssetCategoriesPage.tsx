import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputNumber } from "primereact/inputnumber";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { useAccounts, type AccountSummary } from "../accounting/use-accounts";
import { usePermissions } from "../../shared/auth/use-permissions";
import { localizedName } from "../../shared/lib/localized-name";
import { DataGrid } from "../../shared/ui/DataGrid";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import {
  fixedAssetErrorKey,
  useAssetCategories,
  useSaveAssetCategory,
  type AssetCategory,
  type AssetCategoryPayload,
  type NamedRef,
} from "./use-fixed-assets";
import "./fixed-assets.css";

interface FormState {
  readonly id: string | null;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string;
  readonly numberPrefix: string;
  readonly isDepreciable: boolean;
  readonly usefulLifeMonths: number | null;
  readonly residualPercent: string;
  readonly assetAccountId: string;
  readonly accumulatedAccountId: string;
  readonly expenseAccountId: string;
  readonly isActive: boolean;
  readonly isLocked: boolean;
}

const EMPTY: FormState = {
  id: null,
  code: "",
  name: "",
  nameAr: "",
  numberPrefix: "",
  isDepreciable: true,
  usefulLifeMonths: null,
  residualPercent: "0",
  assetAccountId: "",
  accumulatedAccountId: "",
  expenseAccountId: "",
  isActive: true,
  isLocked: false,
};

const toForm = (row: AssetCategory): FormState => ({
  id: row.id,
  code: row.code,
  name: row.name,
  nameAr: row.nameAr ?? "",
  numberPrefix: row.numberPrefix,
  isDepreciable: row.isDepreciable,
  usefulLifeMonths: row.defaultUsefulLifeMonths,
  residualPercent: row.defaultResidualPercent,
  assetAccountId: row.assetAccount.id,
  accumulatedAccountId: row.accumulatedDepreciationAccount?.id ?? "",
  expenseAccountId: row.depreciationExpenseAccount?.id ?? "",
  isActive: row.isActive,
  isLocked: row.isLocked,
});

// Each category sets an asset's default life, residual value, number prefix and the three ledger
// accounts its depreciation passes through. Once an asset of the category reaches the ledger those
// settings are locked, because changing them would rewrite the meaning of posted entries.
export function AssetCategoriesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const { data, isPending, isError, refetch } = useAssetCategories(includeInactive);
  const { data: accounts } = useAccounts();
  const save = useSaveAssetCategory();

  const manage = can("fixed_asset_category:manage");
  const editing = form?.id != null;
  const locked = form !== null && editing && form.isLocked;

  const openNew = (): void => {
    save.reset();
    setForm(EMPTY);
  };
  const openEdit = (row: AssetCategory): void => {
    save.reset();
    setForm(toForm(row));
  };

  const accountLabel = (account: AccountSummary): string => `${account.code} — ${localizedName(account, i18n.language)}`;
  const accountOptions = (predicate: (account: AccountSummary) => boolean): { label: string; value: string }[] =>
    (accounts ?? []).filter(predicate).map((account) => ({ label: accountLabel(account), value: account.id }));

  const assetAccounts = accountOptions((a) => a.type === "ASSET" && a.normalBalance !== "CREDIT");
  const contraAccounts = accountOptions((a) => a.type === "ASSET" && a.normalBalance === "CREDIT");
  const expenseAccounts = accountOptions((a) => a.type === "EXPENSE");

  const canSubmit =
    form !== null &&
    form.name.trim() !== "" &&
    form.numberPrefix.trim() !== "" &&
    form.assetAccountId !== "" &&
    (editing || form.code.trim() !== "") &&
    (!form.isDepreciable ||
      (form.usefulLifeMonths !== null &&
        form.usefulLifeMonths >= 1 &&
        form.usefulLifeMonths <= 1200 &&
        form.accumulatedAccountId !== "" &&
        form.expenseAccountId !== ""));

  const submit = (): void => {
    if (!form || !canSubmit) return;
    const payload: AssetCategoryPayload = {
      name: form.name.trim(),
      ...(form.nameAr.trim() ? { nameAr: form.nameAr.trim() } : {}),
      numberPrefix: form.numberPrefix.trim(),
      isDepreciable: form.isDepreciable,
      assetAccountId: form.assetAccountId,
      ...(form.isDepreciable
        ? {
            defaultUsefulLifeMonths: form.usefulLifeMonths ?? 1,
            defaultResidualPercent: form.residualPercent.trim() === "" ? "0" : form.residualPercent.trim(),
            accumulatedDepreciationAccountId: form.accumulatedAccountId,
            depreciationExpenseAccountId: form.expenseAccountId,
          }
        : {}),
      ...(editing ? { isActive: form.isActive } : {}),
    };
    save.mutate(
      form.id !== null ? { id: form.id, ...payload } : { ...payload, code: form.code.trim() },
      { onSuccess: () => setForm(null) },
    );
  };

  const accountCell = (ref: NamedRef | null): React.JSX.Element =>
    ref ? (
      <span>
        <span className="coa-code" dir="ltr">{ref.code}</span>{" "}
        {localizedName(ref, i18n.language)}
      </span>
    ) : (
      <span>—</span>
    );

  const categoryName = (row: AssetCategory): string => localizedName(row, i18n.language);
  const monthCount = (row: AssetCategory): string =>
    row.isDepreciable
      ? t("fixedAssets.fields.monthsCount", { count: row.defaultUsefulLifeMonths ?? 0 })
      : t("fixedAssets.categories.notDepreciable");

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("fixedAssets.categories.title")}</h1>
          <p className="erp-page__subtitle">{t("fixedAssets.categories.subtitle")}</p>
        </div>
        <div className="erp-page__header-actions">
          <label className="coa-levels" htmlFor="assetCategoriesInactive">
            <InputSwitch inputId="assetCategoriesInactive" checked={includeInactive} onChange={(e) => setIncludeInactive(Boolean(e.value))} />
            <span className="coa-levels__label">{t("fixedAssets.categories.showInactive")}</span>
          </label>
          <PermissionButton allowed={manage} label={t("fixedAssets.categories.new")} icon="pi pi-plus" onClick={openNew} />
        </div>
      </div>

      {isPending ? (
        <PageSkeleton />
      ) : isError ? (
        <div>
          <p className="erp-page__error">{t("status.error")}</p>
          <button type="button" className="erp-button-link" onClick={() => void refetch()}>
            {t("actions.retry")}
          </button>
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          icon="pi pi-tags"
          title={t("fixedAssets.categories.emptyTitle")}
          hint={t("fixedAssets.categories.emptyHint")}
        />
      ) : (
        <DataGrid
          value={data}
          className="erp-table"
          stripedRows
          showGridlines
          size="small"
          emptyMessage={t("fixedAssets.categories.emptyTitle")}
          emptyIcon="pi pi-tags"
          selectionMode="single"
          onRowClick={(e) => {
            if (manage) openEdit(e.data as AssetCategory);
          }}
        >
          <Column header={t("fixedAssets.categories.code")} style={{ width: "8rem" }} body={(row: AssetCategory) => <span className="coa-code" dir="ltr">{row.code}</span>} />
          <Column header={t("fixedAssets.categories.name")} body={(row: AssetCategory) => <span>{categoryName(row)}</span>} />
          <Column header={t("fixedAssets.categories.prefix")} style={{ width: "9rem" }} body={(row: AssetCategory) => <span className="coa-code" dir="ltr">{`${row.numberPrefix}-000001`}</span>} />
          <Column header={t("fixedAssets.categories.depreciable")} style={{ width: "9rem" }} body={(row: AssetCategory) => monthCount(row)} />
          <Column header={t("fixedAssets.categories.assetAccount")} body={(row: AssetCategory) => accountCell(row.assetAccount)} />
          <Column header={t("fixedAssets.categories.accumulatedAccount")} body={(row: AssetCategory) => accountCell(row.accumulatedDepreciationAccount)} />
          <Column header={t("fixedAssets.categories.expenseAccount")} body={(row: AssetCategory) => accountCell(row.depreciationExpenseAccount)} />
          <Column header={t("fixedAssets.categories.assets")} style={{ width: "7rem" }} align="right" body={(row: AssetCategory) => <span dir="ltr">{row.assetCount}</span>} />
          <Column
            header={t("fixedAssets.fields.status")}
            style={{ width: "9rem" }}
            body={(row: AssetCategory) => (
              <span>
                <Tag value={t(row.isActive ? "fixedAssets.categories.active" : "fixedAssets.categories.inactive")} severity={row.isActive ? "success" : "secondary"} />
                {row.isLocked ? (
                  <i className="pi pi-lock fa-catchup" title={t("fixedAssets.categories.locked")} aria-label={t("fixedAssets.categories.locked")} />
                ) : null}
              </span>
            )}
          />
        </DataGrid>
      )}

      <Dialog
        header={t(editing ? "fixedAssets.categories.edit" : "fixedAssets.categories.new")}
        visible={form !== null}
        onHide={() => setForm(null)}
        className="erp-dialog"
        modal
        style={{ width: "min(42rem, 96vw)" }}
      >
        {form ? (
          <div className="erp-form">
            <div className="erp-form__row">
              <div className="erp-field">
                <label htmlFor="assetCategoryCode">{t("fixedAssets.categories.code")}</label>
                <InputText id="assetCategoryCode" dir="ltr" value={form.code} disabled={editing} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div className="erp-field">
                <label htmlFor="assetCategoryPrefix">{t("fixedAssets.categories.prefix")}</label>
                <InputText id="assetCategoryPrefix" dir="ltr" value={form.numberPrefix} disabled={locked} onChange={(e) => setForm({ ...form, numberPrefix: e.target.value })} />
                <small className="erp-field__hint">
                  {t("fixedAssets.categories.prefixHint", { example: `${form.numberPrefix.trim() || "VEH"}-000001` })}
                </small>
              </div>
            </div>

            <div className="erp-form__row">
              <div className="erp-field">
                <label htmlFor="assetCategoryName">{t("fixedAssets.categories.name")}</label>
                <InputText id="assetCategoryName" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="erp-field">
                <label htmlFor="assetCategoryNameAr">{t("fixedAssets.categories.nameAr")}</label>
                <InputText id="assetCategoryNameAr" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
              </div>
            </div>

            <div className="erp-field">
              <label className="coa-levels" htmlFor="assetCategoryDepreciable">
                <InputSwitch
                  inputId="assetCategoryDepreciable"
                  checked={form.isDepreciable}
                  disabled={locked}
                  onChange={(e) => setForm({ ...form, isDepreciable: Boolean(e.value) })}
                />
                <span className="coa-levels__label">{t("fixedAssets.categories.depreciable")}</span>
              </label>
              <small className="erp-field__hint">{t("fixedAssets.categories.depreciableHint")}</small>
            </div>

            {form.isDepreciable ? (
              <div className="erp-form__row">
                <div className="erp-field">
                  <label htmlFor="assetCategoryLife">{t("fixedAssets.categories.life")}</label>
                  <InputNumber
                    inputId="assetCategoryLife"
                    value={form.usefulLifeMonths}
                    min={1}
                    max={1200}
                    useGrouping={false}
                    dir="ltr"
                    onValueChange={(e) => setForm({ ...form, usefulLifeMonths: e.value ?? null })}
                  />
                </div>
                <div className="erp-field">
                  <label htmlFor="assetCategoryResidual">{t("fixedAssets.categories.residualPercent")}</label>
                  <InputText id="assetCategoryResidual" dir="ltr" value={form.residualPercent} onChange={(e) => setForm({ ...form, residualPercent: e.target.value })} />
                </div>
              </div>
            ) : null}

            <div className="erp-field">
              <label htmlFor="assetCategoryAssetAccount">{t("fixedAssets.categories.assetAccount")}</label>
              <Dropdown
                inputId="assetCategoryAssetAccount"
                value={form.assetAccountId || null}
                options={assetAccounts}
                filter
                disabled={locked}
                onChange={(e) => setForm({ ...form, assetAccountId: (e.value as string | null) ?? "" })}
              />
              <small className="erp-field__hint">{t("fixedAssets.categories.assetAccountHint")}</small>
            </div>

            {form.isDepreciable ? (
              <>
                <div className="erp-field">
                  <label htmlFor="assetCategoryAccumulatedAccount">{t("fixedAssets.categories.accumulatedAccount")}</label>
                  <Dropdown
                    inputId="assetCategoryAccumulatedAccount"
                    value={form.accumulatedAccountId || null}
                    options={contraAccounts}
                    filter
                    disabled={locked}
                    onChange={(e) => setForm({ ...form, accumulatedAccountId: (e.value as string | null) ?? "" })}
                  />
                  <small className="erp-field__hint">
                    {contraAccounts.length === 0
                      ? t("fixedAssets.categories.noContraAccounts")
                      : t("fixedAssets.categories.accumulatedAccountHint")}
                  </small>
                </div>

                <div className="erp-field">
                  <label htmlFor="assetCategoryExpenseAccount">{t("fixedAssets.categories.expenseAccount")}</label>
                  <Dropdown
                    inputId="assetCategoryExpenseAccount"
                    value={form.expenseAccountId || null}
                    options={expenseAccounts}
                    filter
                    disabled={locked}
                    onChange={(e) => setForm({ ...form, expenseAccountId: (e.value as string | null) ?? "" })}
                  />
                  <small className="erp-field__hint">{t("fixedAssets.categories.expenseAccountHint")}</small>
                </div>
              </>
            ) : null}

            {editing ? (
              <div className="erp-field">
                <label className="coa-levels" htmlFor="assetCategoryActive">
                  <InputSwitch inputId="assetCategoryActive" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: Boolean(e.value) })} />
                  <span className="coa-levels__label">{t("fixedAssets.categories.active")}</span>
                </label>
              </div>
            ) : null}

            {locked ? (
              <p className="erp-field__hint">
                <i className="pi pi-lock" aria-hidden="true" /> {t("fixedAssets.categories.locked")}
              </p>
            ) : null}

            {save.isError ? <p className="erp-auth-card__error">{t(fixedAssetErrorKey(save.error))}</p> : null}

            <div className="erp-form__actions">
              <Button type="button" label={t("actions.cancel")} text onClick={() => setForm(null)} />
              <Button type="button" label={t("actions.save")} disabled={!canSubmit} loading={save.isPending} onClick={submit} />
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
