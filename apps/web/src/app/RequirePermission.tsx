import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router-dom";
import { usePermissions } from "../shared/auth/use-permissions";
import { PageSkeleton } from "../shared/ui/PageSkeleton";

// Route guard mirroring the API's permission check: a user typing the URL of a page they
// may not see gets a plain "no access" notice instead of that page's data request failing
// with a generic error. The API still refuses the requests regardless.
export function RequirePermission({ anyOf }: { anyOf: readonly string[] }): React.JSX.Element {
  const { t } = useTranslation();
  const { isReady, isError, canAny } = usePermissions();

  if (isError) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
      </div>
    );
  }
  if (!isReady) {
    return <PageSkeleton />;
  }
  if (!canAny(anyOf)) {
    return (
      <div className="erp-page">
        <p className="erp-page__empty">{t("status.noAccess")}</p>
        <Link to="/" className="erp-button-link">
          {t("nav.dashboard")}
        </Link>
      </div>
    );
  }
  return <Outlet />;
}
