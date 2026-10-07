import { useTranslation } from "react-i18next";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { usePermissions } from "../../shared/auth/use-permissions";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PictureField } from "../attachments/PictureField";
import { useOwnerAttachments } from "../attachments/use-attachments";

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
            <dt>{t("company.name")}</dt>
            <dd>{user.companyName}</dd>
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
    </div>
  );
}
