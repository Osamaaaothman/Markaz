import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Money } from "@erp/shared";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useAllEmployees } from "../hr/use-hr";
import { usePartySearch } from "../parties/use-parties";
import "./fixed-assets.css";
import { useCostCenters } from "../payments/use-cost-centers";
import {
  fixedAssetErrorKey,
  useAssetCategories,
  useCreateDraftAsset,
  useFixedAsset,
  useRegisterOpeningAsset,
  useUpdateDraftAsset,
  type FixedAssetDetailsPayload,
} from "./use-fixed-assets";

const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;

interface FormState {
  name: string;
  nameAr: string;
  description: string;
  categoryId: string;
  acquisitionDate: Date;
  inServiceDate: Date;
  acquisitionCost: string;
  residualValue: string;
  usefulLifeMonths: number | null;
  supplierPartyId: string;
  custodianEmployeeId: string;
  costCenterId: string;
  location: string;
  serialNumber: string;
  barcode: string;
  openingAccumulatedDepreciation: string;
  openingAsOfDate: Date;
}

const today = (): Date => new Date();
const fromIso = (iso: string): Date => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1);
};

const EMPTY: FormState = {
  name: "",
  nameAr: "",
  description: "",
  categoryId: "",
  acquisitionDate: today(),
  inServiceDate: today(),
  acquisitionCost: "",
  residualValue: "",
  usefulLifeMonths: null,
  supplierPartyId: "",
  custodianEmployeeId: "",
  costCenterId: "",
  location: "",
  serialNumber: "",
  barcode: "",
  openingAccumulatedDepreciation: "0",
  openingAsOfDate: today(),
};

// One form for three jobs: a new draft, editing a draft, and an opening asset that posts straight to the ledger.
export function FixedAssetFormPage({ mode }: { readonly mode: "new" | "edit" | "opening" }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const existing = useFixedAsset(mode === "edit" ? id : "");
  const categories = useAssetCategories();
  const employees = useAllEmployees();
  const centers = useCostCenters();
  const suppliers = usePartySearch("", true);
  const createDraft = useCreateDraftAsset();
  const updateDraft = useUpdateDraftAsset(id);
  const registerOpening = useRegisterOpeningAsset();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState(mode !== "edit");

  useEffect(() => {
    if (mode !== "edit" || !existing.data || loaded) return;
    const a = existing.data;
    setForm({
      ...EMPTY,
      name: a.name,
      nameAr: a.nameAr ?? "",
      description: a.description ?? "",
      categoryId: a.category.id,
      acquisitionDate: fromIso(a.acquisitionDate),
      inServiceDate: fromIso(a.inServiceDate),
      acquisitionCost: a.acquisitionCost.replace(/\.?0+$/, ""),
      residualValue: a.residualValue.replace(/\.?0+$/, ""),
      usefulLifeMonths: a.usefulLifeMonths,
      supplierPartyId: a.supplier?.id ?? "",
      custodianEmployeeId: a.custodian?.id ?? "",
      costCenterId: a.costCenter?.id ?? "",
      location: a.location ?? "",
      serialNumber: a.serialNumber ?? "",
      barcode: a.barcode ?? "",
    });
    setLoaded(true);
  }, [mode, existing.data, loaded]);

  const category = (categories.data ?? []).find((c) => c.id === form.categoryId) ?? null;
  const mutation = mode === "opening" ? registerOpening : mode === "edit" ? updateDraft : createDraft;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
    mutation.reset();
  };

  const costOk = DECIMAL.test(form.acquisitionCost) && /[1-9]/.test(form.acquisitionCost);
  const residualOk = form.residualValue === "" || DECIMAL.test(form.residualValue);
  const openingOk = mode !== "opening" || DECIMAL.test(form.openingAccumulatedDepreciation);
  const lifeOk = !category?.isDepreciable || form.usefulLifeMonths !== null || category.defaultUsefulLifeMonths !== null;
  const datesOk = form.inServiceDate >= new Date(form.acquisitionDate.getFullYear(), form.acquisitionDate.getMonth(), form.acquisitionDate.getDate());
  const valid = form.name.trim() !== "" && category !== null && costOk && residualOk && openingOk && lifeOk && datesOk;

  // A rough monthly figure so the user sees what the asset will cost each month (the real runs are by the day).
  const monthly = useMemo(() => {
    if (!category?.isDepreciable || !costOk) return null;
    const life = form.usefulLifeMonths ?? category.defaultUsefulLifeMonths;
    if (!life) return null;
    const cost = Money.of(form.acquisitionCost, "SAR");
    const residual = form.residualValue && DECIMAL.test(form.residualValue)
      ? Money.of(form.residualValue, "SAR")
      : cost.multiply(category.defaultResidualPercent).multiply("0.01");
    // Display estimate only (the posted amounts come from the server, by the day).
    return cost.subtract(residual).multiply(1 / life).toDecimalString(2);
  }, [category, costOk, form.acquisitionCost, form.residualValue, form.usefulLifeMonths]);

  const submit = (): void => {
    if (!valid) return;
    const payload: FixedAssetDetailsPayload = {
      name: form.name.trim(),
      categoryId: form.categoryId,
      acquisitionDate: toDateOnlyIsoString(form.acquisitionDate),
      inServiceDate: toDateOnlyIsoString(form.inServiceDate),
      acquisitionCost: form.acquisitionCost,
      ...(form.nameAr.trim() ? { nameAr: form.nameAr.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.residualValue !== "" ? { residualValue: form.residualValue } : {}),
      ...(category?.isDepreciable && form.usefulLifeMonths !== null ? { usefulLifeMonths: form.usefulLifeMonths } : {}),
      ...(form.supplierPartyId ? { supplierPartyId: form.supplierPartyId } : {}),
      ...(form.custodianEmployeeId ? { custodianEmployeeId: form.custodianEmployeeId } : {}),
      ...(form.costCenterId ? { costCenterId: form.costCenterId } : {}),
      ...(form.location.trim() ? { location: form.location.trim() } : {}),
      ...(form.serialNumber.trim() ? { serialNumber: form.serialNumber.trim() } : {}),
      ...(form.barcode.trim() ? { barcode: form.barcode.trim() } : {}),
    };
    if (mode === "opening") {
      if (!window.confirm(t("fixedAssets.form.openingConfirm"))) return;
      registerOpening.mutate(
        { ...payload, openingAccumulatedDepreciation: form.openingAccumulatedDepreciation, openingAsOfDate: toDateOnlyIsoString(form.openingAsOfDate) },
        { onSuccess: (r) => void navigate(`/fixed-assets/${r.id}`) },
      );
    } else if (mode === "edit") {
      updateDraft.mutate(payload, { onSuccess: () => void navigate(`/fixed-assets/${id}`) });
    } else {
      createDraft.mutate(payload, { onSuccess: (r) => void navigate(`/fixed-assets/${r.id}`) });
    }
  };

  if (!loaded || categories.isPending) return <PageSkeleton />;

  const title = mode === "opening" ? t("fixedAssets.form.openingTitle") : mode === "edit" ? t("fixedAssets.form.editTitle") : t("fixedAssets.form.newTitle");
  const subtitle = mode === "opening" ? t("fixedAssets.form.openingSubtitle") : t("fixedAssets.form.newSubtitle");
  const categoryOptions = (categories.data ?? []).map((c) => ({ label: `${c.code} — ${localizedName(c, i18n.language)}`, value: c.id }));

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{title}</h1>
          <p className="erp-page__subtitle">{subtitle}</p>
        </div>
      </div>

      <form className="erp-form" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h3 className="erp-form__section-title">{t("fixedAssets.form.identity")}</h3>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="faName">{t("fixedAssets.fields.name")}</label>
            <InputText id="faName" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={200} />
          </div>
          <div className="erp-field">
            <label htmlFor="faNameAr">{t("fixedAssets.fields.nameAr")}</label>
            <InputText id="faNameAr" value={form.nameAr} onChange={(e) => set("nameAr", e.target.value)} maxLength={200} dir="rtl" />
          </div>
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="faCategory">{t("fixedAssets.fields.category")}</label>
            <Dropdown inputId="faCategory" value={form.categoryId || null} options={categoryOptions} onChange={(e) => set("categoryId", (e.value as string | null) ?? "")} filter placeholder={t("fixedAssets.form.selectCategory")} emptyMessage={t("fixedAssets.form.noCategories")} />
            {categoryOptions.length === 0 ? (
              <button type="button" className="erp-button-link" onClick={() => void navigate("/fixed-assets/categories")}>{t("fixedAssets.form.manageCategories")}</button>
            ) : null}
          </div>
          <div className="erp-field">
            <label htmlFor="faSerial">{t("fixedAssets.fields.serialNumber")}</label>
            <InputText id="faSerial" value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} dir="ltr" maxLength={100} />
          </div>
          <div className="erp-field">
            <label htmlFor="faBarcode">{t("fixedAssets.fields.barcode")}</label>
            <InputText id="faBarcode" value={form.barcode} onChange={(e) => set("barcode", e.target.value)} dir="ltr" maxLength={100} />
          </div>
        </div>
        <div className="erp-field">
          <label htmlFor="faDesc">{t("fixedAssets.fields.description")}</label>
          <InputTextarea id="faDesc" value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} autoResize maxLength={1000} />
        </div>

        <h3 className="erp-form__section-title">{t("fixedAssets.form.money")}</h3>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="faAcq">{t("fixedAssets.fields.acquisitionDate")}</label>
            <Calendar inputId="faAcq" value={form.acquisitionDate} onChange={(e) => e.value && set("acquisitionDate", e.value)} dateFormat="yy-mm-dd" showIcon />
          </div>
          <div className="erp-field">
            <label htmlFor="faInService">{t("fixedAssets.fields.inServiceDate")}</label>
            <Calendar inputId="faInService" value={form.inServiceDate} onChange={(e) => e.value && set("inServiceDate", e.value)} dateFormat="yy-mm-dd" showIcon className={datesOk ? "" : "p-invalid"} />
            {!datesOk ? <small className="erp-field__error">{t("fixedAssets.errors.IN_SERVICE_BEFORE_ACQUISITION")}</small> : null}
          </div>
          <div className="erp-field">
            <label htmlFor="faCost">{t("fixedAssets.fields.acquisitionCost")}</label>
            <InputText id="faCost" value={form.acquisitionCost} onChange={(e) => set("acquisitionCost", e.target.value.trim())} inputMode="decimal" dir="ltr" className={form.acquisitionCost && !costOk ? "p-invalid" : ""} />
          </div>
        </div>
        {category && !category.isDepreciable ? (
          <p className="fa-notice"><i className="pi pi-info-circle" /> {t("fixedAssets.form.notDepreciable")}</p>
        ) : (
          <div className="erp-form__row">
            <div className="erp-field">
              <label htmlFor="faResidual">{t("fixedAssets.fields.residualValue")}</label>
              <InputText id="faResidual" value={form.residualValue} onChange={(e) => set("residualValue", e.target.value.trim())} inputMode="decimal" dir="ltr" className={residualOk ? "" : "p-invalid"} />
              {category ? <small className="erp-field__hint">{t("fixedAssets.form.residualHint", { percent: Number(category.defaultResidualPercent).toString() })}</small> : null}
            </div>
            <div className="erp-field">
              <label htmlFor="faLife">{t("fixedAssets.fields.usefulLifeMonths")}</label>
              <InputNumber inputId="faLife" value={form.usefulLifeMonths} onValueChange={(e) => set("usefulLifeMonths", e.value ?? null)} min={1} max={1200} useGrouping={false} />
              {category?.defaultUsefulLifeMonths ? <small className="erp-field__hint">{t("fixedAssets.form.lifeHint", { months: category.defaultUsefulLifeMonths })}</small> : null}
            </div>
            <div className="erp-field">
              <label>{t("fixedAssets.fields.method")}</label>
              <InputText value={t("fixedAssets.fields.straightLine")} readOnly disabled />
              {monthly ? <small className="erp-field__hint" dir="auto">{t("fixedAssets.form.monthlyEstimate", { amount: formatMoney(monthly, "SAR").replace(/ SAR$/, "") })}</small> : null}
            </div>
          </div>
        )}

        {mode === "opening" ? (
          <>
            <h3 className="erp-form__section-title">{t("fixedAssets.form.opening")}</h3>
            <p className="erp-field__hint">{t("fixedAssets.form.openingHint")}</p>
            <div className="erp-form__row">
              <div className="erp-field">
                <label htmlFor="faOpeningDate">{t("fixedAssets.fields.openingAsOfDate")}</label>
                <Calendar inputId="faOpeningDate" value={form.openingAsOfDate} onChange={(e) => e.value && set("openingAsOfDate", e.value)} dateFormat="yy-mm-dd" showIcon />
              </div>
              <div className="erp-field">
                <label htmlFor="faOpeningAcc">{t("fixedAssets.fields.openingAccumulated")}</label>
                <InputText id="faOpeningAcc" value={form.openingAccumulatedDepreciation} onChange={(e) => set("openingAccumulatedDepreciation", e.target.value.trim())} inputMode="decimal" dir="ltr" disabled={category !== null && !category.isDepreciable} className={openingOk ? "" : "p-invalid"} />
              </div>
            </div>
          </>
        ) : null}

        <h3 className="erp-form__section-title">{t("fixedAssets.form.placement")}</h3>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="faLocation">{t("fixedAssets.fields.location")}</label>
            <InputText id="faLocation" value={form.location} onChange={(e) => set("location", e.target.value)} maxLength={200} />
          </div>
          <div className="erp-field">
            <label htmlFor="faCustodian">{t("fixedAssets.fields.custodian")}</label>
            <Dropdown inputId="faCustodian" value={form.custodianEmployeeId || null} options={(employees.data ?? []).map((e) => ({ label: `${e.ref} — ${localizedName(e, i18n.language)}`, value: e.id }))} onChange={(e) => set("custodianEmployeeId", (e.value as string | null) ?? "")} filter showClear placeholder={t("fixedAssets.form.selectEmployee")} />
          </div>
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="faCenter">{t("fixedAssets.fields.costCenter")}</label>
            <Dropdown inputId="faCenter" value={form.costCenterId || null} options={(centers.data ?? []).filter((c) => c.isActive).map((c) => ({ label: `${c.code} — ${localizedName(c, i18n.language)}`, value: c.id }))} onChange={(e) => set("costCenterId", (e.value as string | null) ?? "")} filter showClear placeholder={t("fixedAssets.form.selectCostCenter")} />
          </div>
          <div className="erp-field">
            <label htmlFor="faSupplier">{t("fixedAssets.fields.supplier")}</label>
            <Dropdown inputId="faSupplier" value={form.supplierPartyId || null} options={(suppliers.data ?? []).map((p) => ({ label: `${p.ref} — ${localizedName(p, i18n.language)}`, value: p.id }))} onChange={(e) => set("supplierPartyId", (e.value as string | null) ?? "")} filter showClear placeholder={t("fixedAssets.form.selectSupplier")} />
          </div>
        </div>

        {mutation.isError ? <p className="erp-auth-card__error">{t(fixedAssetErrorKey(mutation.error))}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={() => void navigate(mode === "edit" ? `/fixed-assets/${id}` : "/fixed-assets")} />
          <Button
            type="submit"
            icon={mode === "opening" ? "pi pi-check" : "pi pi-save"}
            label={mode === "opening" ? t("fixedAssets.form.registerOpening") : mode === "edit" ? t("fixedAssets.form.saveChanges") : t("fixedAssets.form.saveDraft")}
            disabled={!valid}
            loading={mutation.isPending}
          />
        </div>
      </form>
    </div>
  );
}
