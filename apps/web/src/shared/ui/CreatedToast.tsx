import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Toast } from "primereact/toast";
import { useCreatedToast } from "./created-toast";

// Lives once in the app shell. Shows the success message of a record that opened on its details screen, above
// whatever is open (a page or a dialog).
export function CreatedToast(): React.JSX.Element {
  const { t } = useTranslation();
  const toast = useRef<Toast>(null);
  const notice = useCreatedToast((state) => state.notice);

  useEffect(() => {
    if (!notice) return;
    toast.current?.show({
      severity: "success",
      summary: t("created.title"),
      detail: notice.headline ? `${notice.title} — ${notice.headline}` : notice.title,
      life: 7000,
    });
  }, [notice, t]);

  return <Toast ref={toast} position={document.documentElement.dir === "rtl" ? "top-left" : "top-right"} />;
}
