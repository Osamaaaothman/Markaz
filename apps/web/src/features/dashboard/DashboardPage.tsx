import { useTranslation } from "react-i18next";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";

export function DashboardPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { data: currentUser, isPending, isError } = useCurrentUser();

  if (isPending) {
    return <PageSkeleton />;
  }

  if (isError || !currentUser) {
    return <p className="erp-page__error">{t("status.error")}</p>;
  }

  return (
    <div className="erp-page">
      <h1 className="erp-page__title">{t("dashboard.welcome", { email: currentUser.email })}</h1>
      <p className="erp-page__subtitle">{t("dashboard.subtitle", { companyName: currentUser.companyName })}</p>
    </div>
  );
}
