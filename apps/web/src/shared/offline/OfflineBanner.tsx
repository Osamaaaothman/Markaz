import { useTranslation } from "react-i18next";
import { useOnlineStatus } from "./use-online-status";
import "./offline.css";

// Shown at the top of the app while the connection is down. It says what still works (reading what was
// opened before) and what does not (any change), so a refused action never comes as a surprise.
export function OfflineBanner(): React.JSX.Element | null {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className="mk-offline" role="status" aria-live="polite">
      <i className="pi pi-wifi" aria-hidden="true" />
      <span>
        <strong>{t("offline.title")}</strong> {t("offline.body")}
      </span>
    </div>
  );
}
