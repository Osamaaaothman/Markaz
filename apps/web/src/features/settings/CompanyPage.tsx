import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { usePermissions } from "../../shared/auth/use-permissions";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PictureField } from "../attachments/PictureField";
import { useOwnerAttachments } from "../attachments/use-attachments";
import { useSetWpsSettings, useWpsSettings } from "../hr/use-hr";

// Company settings: the name as the company is registered, and the logo. The logo is printed at the top of
// invoices and shown in the side bar. Only people with company:update may change it.
export function CompanyPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const { data: user } = useCurrentUser();
  const companyId = user?.companyId ?? "";
  const { data: files, isPending } = useOwnerAttachments("COMPANY", companyId, companyId !== "");

  if (!user || isPending) return <PageSkeleton />;
  const current = files?.[0]?.id ?? null;

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("company.title")}</h1>
          <p className="erp-page__subtitle">{t("company.subtitle")}</p>
        </div>
      </div>

      <section className="erp-card">
        <h2 className="erp-card__title">{t("company.details")}</h2>
        <dl className="mk-facts">
          <div>
            <dt>{t("company.nameEn")}</dt>
            <dd dir="ltr">{user.companyName}</dd>
          </div>
          <div>
            <dt>{t("company.nameAr")}</dt>
            <dd dir="rtl">{user.companyNameAr ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("company.currency")}</dt>
            <dd dir="ltr">{user.companyDefaultCurrency}</dd>
          </div>
        </dl>
      </section>

      <section className="erp-card">
        <h2 className="erp-card__title">{t("company.logo")}</h2>
        <p className="erp-card__empty" style={{ textAlign: "start" }}>
          {t("company.logoHint")}
        </p>
        <PictureField
          key={current ?? "none"}
          ownerType="COMPANY"
          ownerId={companyId}
          imagePath="/v1/company/logo"
          currentPictureId={current}
          canChange={can("company:update")}
          label={t("company.logo")}
        />
      </section>

      <WpsSettingsCard canEdit={can("company:update")} />
    </div>
  );
}

// The company-level fields the WPS wages file's header group needs (docs: packages/core/src/hr/wps-file.ts).
// Nothing here touches Mudad or any bank directly -- it is local configuration, used only when a payroll
// run's wages file is downloaded.
function WpsSettingsCard({ canEdit }: { readonly canEdit: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const { data: settings, isPending } = useWpsSettings();
  const setSettings = useSetWpsSettings();
  const [bankSarieId, setBankSarieId] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [molEstablishmentId, setMolEstablishmentId] = useState("");

  useEffect(() => {
    if (!settings) return;
    setBankSarieId(settings.bankSarieId ?? "");
    setBankAccountNumber(settings.bankAccountNumber ?? "");
    setMolEstablishmentId(settings.molEstablishmentId ?? "");
  }, [settings]);

  if (isPending) return <PageSkeleton />;

  return (
    <section className="erp-card">
      <h2 className="erp-card__title">{t("hr.wps.title")}</h2>
      <p className="erp-card__empty" style={{ textAlign: "start" }}>
        {t("hr.wps.hint")}
      </p>
      <div className="erp-form__row">
        <div className="erp-field">
          <label htmlFor="wpsSarie">{t("hr.wps.bankSarieId")}</label>
          <InputText id="wpsSarie" dir="ltr" value={bankSarieId} onChange={(e) => setBankSarieId(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="erp-field">
          <label htmlFor="wpsAccount">{t("hr.wps.bankAccountNumber")}</label>
          <InputText id="wpsAccount" dir="ltr" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="erp-field">
          <label htmlFor="wpsMol">{t("hr.wps.molEstablishmentId")}</label>
          <InputText id="wpsMol" dir="ltr" value={molEstablishmentId} onChange={(e) => setMolEstablishmentId(e.target.value)} disabled={!canEdit} />
        </div>
      </div>
      {canEdit ? (
        <div className="erp-form__actions">
          <Button
            type="button"
            label={t("actions.save")}
            loading={setSettings.isPending}
            disabled={!bankSarieId.trim() || !bankAccountNumber.trim() || !molEstablishmentId.trim()}
            onClick={() => setSettings.mutate({ bankSarieId: bankSarieId.trim(), bankAccountNumber: bankAccountNumber.trim(), molEstablishmentId: molEstablishmentId.trim() })}
          />
        </div>
      ) : null}
    </section>
  );
}
