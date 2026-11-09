import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { DataGrid } from "../../shared/ui/DataGrid";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { usePermissions } from "../../shared/auth/use-permissions";
import {
  useComplianceOverview,
  useCreateEgsUnit,
  useUpdateSellerProfile,
  type EgsUnitView,
  type ExpiryState,
  type SellerProfileInput,
} from "./use-compliance";
import { EgsOnboardingDialog } from "./EgsOnboardingDialog";

const CR_SCHEMES = ["CRN", "MOM", "MLS", "SAG", "OTH", "NAT", "GCC", "IQA", "PAS", "CCN", "CBI"];

function expirySeverity(expiry: ExpiryState | null): "success" | "warning" | "danger" | "secondary" {
  if (expiry === "EXPIRED") return "danger";
  if (expiry === "EXPIRING_SOON") return "warning";
  if (expiry === "OK") return "success";
  return "secondary";
}

export function CompliancePage(): React.JSX.Element {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const { data, isPending, isError, refetch } = useComplianceOverview();
  const [activeEgsId, setActiveEgsId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

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
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("compliance.title")}</h1>
          <p className="erp-page__subtitle">{t("compliance.subtitle")}</p>
        </div>
        <Tag value={t(`compliance.environment.${data.environment}`)} severity={data.environment === "production" ? "danger" : "info"} />
      </div>

      <SellerProfileCard profile={data.seller} />

      <section className="erp-card">
        <div className="erp-card__header">
          <h2 className="erp-card__title">{t("compliance.egsUnits.title")}</h2>
          <PermissionButton allowed={can("compliance:manage") && data.seller.complete} label={t("compliance.egsUnits.add")} icon="pi pi-plus" onClick={() => setCreateOpen(true)} />
        </div>
        {!data.seller.complete ? <p className="erp-field__hint">{t("compliance.egsUnits.needsProfile")}</p> : null}
        <DataGrid value={[...data.egsUnits]} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("compliance.egsUnits.empty")} selectionMode="single" onRowClick={(e) => setActiveEgsId((e.data as EgsUnitView).id)}>
          <Column header={t("compliance.egsUnits.name")} body={(r: EgsUnitView) => r.name} />
          <Column header={t("compliance.egsUnits.branch")} body={(r: EgsUnitView) => r.branchName ?? "—"} />
          <Column header={t("compliance.egsUnits.status")} body={(r: EgsUnitView) => <Tag value={t(`compliance.egsStatus.${r.status}`)} severity={r.status === "ACTIVE" ? "success" : "secondary"} />} />
          <Column header={t("compliance.egsUnits.certificate")} body={(r: EgsUnitView) => (r.expiry ? <Tag value={t(`compliance.expiry.${r.expiry}`, { days: r.daysUntilExpiry })} severity={expirySeverity(r.expiry)} /> : "—")} />
          <Column header="" style={{ width: "8rem" }} body={(r: EgsUnitView) => <Button type="button" label={t("compliance.egsUnits.manage")} text onClick={() => setActiveEgsId(r.id)} />} />
        </DataGrid>
      </section>

      <CreateEgsUnitDialog visible={createOpen} onHide={() => setCreateOpen(false)} />
      {activeEgsId ? <EgsOnboardingDialog egsUnitId={activeEgsId} visible={true} onHide={() => setActiveEgsId(null)} /> : null}
    </div>
  );
}

function SellerProfileCard({ profile }: { readonly profile: NonNullable<ReturnType<typeof useComplianceOverview>["data"]>["seller"] }): React.JSX.Element {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const update = useUpdateSellerProfile();
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<SellerProfileInput>({});

  const field = (key: keyof SellerProfileInput): string => (key in form ? (form[key] ?? "") : (profile[key] ?? ""));
  const setField = (key: keyof SellerProfileInput, value: string): void => setForm((prev) => ({ ...prev, [key]: value }));

  if (!edit) {
    return (
      <section className="erp-card">
        <div className="erp-card__header">
          <h2 className="erp-card__title">{t("compliance.sellerProfile.title")}</h2>
          {profile.locked ? <Tag value={t("compliance.sellerProfile.locked")} severity="warning" icon="pi pi-lock" /> : null}
          <PermissionButton allowed={can("compliance:manage")} label={t("actions.edit")} icon="pi pi-pencil" text onClick={() => { setForm({ countryCode: profile.countryCode ?? "SA" }); setEdit(true); }} />
        </div>
        {!profile.complete ? <p className="erp-auth-card__error">{t("compliance.sellerProfile.incomplete", { fields: profile.missing.join(", ") })}</p> : null}
        <dl className="erp-detail-grid">
          <dt>{t("compliance.sellerProfile.nameAr")}</dt>
          <dd>{profile.nameAr ?? "—"}</dd>
          <dt>{t("compliance.sellerProfile.vatNumber")}</dt>
          <dd dir="ltr">{profile.vatNumber ?? "—"}</dd>
          <dt>{t("compliance.sellerProfile.crNumber")}</dt>
          <dd dir="ltr">{profile.crNumber ?? "—"} {profile.crNumberScheme ?? ""}</dd>
          <dt>{t("compliance.sellerProfile.address")}</dt>
          <dd>{[profile.streetName, profile.buildingNumber, profile.district, profile.city, profile.postalCode].filter(Boolean).join(", ") || "—"}</dd>
          <dt>{t("compliance.sellerProfile.phone")}</dt>
          <dd dir="ltr">{profile.phone ?? "—"}</dd>
        </dl>
      </section>
    );
  }

  return (
    <section className="erp-card">
      <h2 className="erp-card__title">{t("compliance.sellerProfile.title")}</h2>
      {profile.locked ? <p className="erp-field__hint">{t("compliance.sellerProfile.lockedHint")}</p> : null}
      <div className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="cp-nameAr">{t("compliance.sellerProfile.nameAr")}</label>
            <InputText id="cp-nameAr" value={field("nameAr")} onChange={(e) => setField("nameAr", e.target.value)} disabled={profile.locked} />
          </div>
          <div className="erp-field">
            <label htmlFor="cp-vat">{t("compliance.sellerProfile.vatNumber")}</label>
            <InputText id="cp-vat" dir="ltr" value={field("vatNumber")} onChange={(e) => setField("vatNumber", e.target.value)} disabled={profile.locked} placeholder="3XXXXXXXXXXXXX3" />
          </div>
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="cp-cr">{t("compliance.sellerProfile.crNumber")}</label>
            <InputText id="cp-cr" dir="ltr" value={field("crNumber")} onChange={(e) => setField("crNumber", e.target.value)} disabled={profile.locked} />
          </div>
          <div className="erp-field">
            <label htmlFor="cp-crScheme">{t("compliance.sellerProfile.crNumberScheme")}</label>
            <Dropdown
              inputId="cp-crScheme"
              value={field("crNumberScheme") || null}
              onChange={(e) => setField("crNumberScheme", (e.value as string | null) ?? "")}
              options={CR_SCHEMES.map((s) => ({ label: s, value: s }))}
              placeholder={t("compliance.sellerProfile.crNumberSchemePlaceholder")}
              disabled={profile.locked}
            />
          </div>
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="cp-street">{t("compliance.sellerProfile.streetName")}</label>
            <InputText id="cp-street" value={field("streetName")} onChange={(e) => setField("streetName", e.target.value)} disabled={profile.locked} />
          </div>
          <div className="erp-field">
            <label htmlFor="cp-building">{t("compliance.sellerProfile.buildingNumber")}</label>
            <InputText id="cp-building" dir="ltr" value={field("buildingNumber")} onChange={(e) => setField("buildingNumber", e.target.value)} disabled={profile.locked} placeholder="0000" />
          </div>
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="cp-district">{t("compliance.sellerProfile.district")}</label>
            <InputText id="cp-district" value={field("district")} onChange={(e) => setField("district", e.target.value)} disabled={profile.locked} />
          </div>
          <div className="erp-field">
            <label htmlFor="cp-city">{t("compliance.sellerProfile.city")}</label>
            <InputText id="cp-city" value={field("city")} onChange={(e) => setField("city", e.target.value)} disabled={profile.locked} />
          </div>
          <div className="erp-field">
            <label htmlFor="cp-postal">{t("compliance.sellerProfile.postalCode")}</label>
            <InputText id="cp-postal" dir="ltr" value={field("postalCode")} onChange={(e) => setField("postalCode", e.target.value)} disabled={profile.locked} placeholder="00000" />
          </div>
          <div className="erp-field">
            <label htmlFor="cp-country">{t("compliance.sellerProfile.countryCode")}</label>
            <InputText id="cp-country" dir="ltr" value={field("countryCode") || "SA"} onChange={(e) => setField("countryCode", e.target.value.toUpperCase())} disabled={profile.locked} maxLength={2} />
          </div>
          <div className="erp-field">
            <label htmlFor="cp-phone">{t("compliance.sellerProfile.phone")}</label>
            <InputText id="cp-phone" dir="ltr" value={field("phone")} onChange={(e) => setField("phone", e.target.value)} />
          </div>
        </div>
        {update.isError ? <p className="erp-auth-card__error">{t("compliance.sellerProfile.saveError")}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={() => setEdit(false)} />
          <Button type="button" label={t("actions.save")} loading={update.isPending} onClick={() => update.mutate(form, { onSuccess: () => setEdit(false) })} />
        </div>
      </div>
    </section>
  );
}

function CreateEgsUnitDialog({ visible, onHide }: { readonly visible: boolean; readonly onHide: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const create = useCreateEgsUnit();
  const [name, setName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [businessCategory, setBusinessCategory] = useState("");
  const [invoiceTypes, setInvoiceTypes] = useState("1100");

  const valid = name.trim() !== "" && businessCategory.trim() !== "" && /^[01]{4}$/.test(invoiceTypes);

  return (
    <Dialog header={t("compliance.egsUnits.add")} visible={visible} onHide={onHide} className="erp-dialog" modal style={{ width: "min(32rem, 96vw)" }}>
      <div className="erp-form">
        <div className="erp-field">
          <label htmlFor="egs-name">{t("compliance.egsUnits.name")}</label>
          <InputText id="egs-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="erp-field">
          <label htmlFor="egs-branch">{t("compliance.egsUnits.branch")}</label>
          <InputText id="egs-branch" value={branchName} onChange={(e) => setBranchName(e.target.value)} />
        </div>
        <div className="erp-field">
          <label htmlFor="egs-category">{t("compliance.egsUnits.businessCategory")}</label>
          <InputText id="egs-category" value={businessCategory} onChange={(e) => setBusinessCategory(e.target.value)} placeholder={t("compliance.egsUnits.businessCategoryPlaceholder")} />
        </div>
        <div className="erp-field">
          <label htmlFor="egs-types">{t("compliance.egsUnits.invoiceTypes")}</label>
          <Dropdown
            inputId="egs-types"
            value={invoiceTypes}
            onChange={(e) => setInvoiceTypes(e.value as string)}
            options={[
              { label: t("compliance.egsUnits.invoiceTypesStandardAndSimplified"), value: "1100" },
              { label: t("compliance.egsUnits.invoiceTypesStandardOnly"), value: "1000" },
              { label: t("compliance.egsUnits.invoiceTypesSimplifiedOnly"), value: "0100" },
            ]}
          />
        </div>
        {create.isError ? <p className="erp-auth-card__error">{t("compliance.egsUnits.createError")}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
          <Button
            type="button"
            label={t("actions.save")}
            disabled={!valid}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { name: name.trim(), businessCategory: businessCategory.trim(), invoiceTypes, ...(branchName.trim() ? { branchName: branchName.trim() } : {}) },
                { onSuccess: () => { onHide(); setName(""); setBranchName(""); setBusinessCategory(""); setInvoiceTypes("1100"); } },
              )
            }
          />
        </div>
      </div>
    </Dialog>
  );
}
