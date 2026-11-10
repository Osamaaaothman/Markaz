import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Toast } from "primereact/toast";
import { useFeedbackStore } from "../lib/feedback-store";

// Mounted outside the routes, so feedback survives navigation and closing a form.
export function FeedbackToast(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const toast = useRef<Toast>(null);
  const notices = useFeedbackStore((state) => state.notices);
  const consume = useFeedbackStore((state) => state.consume);
  useEffect(() => {
    if (!notices.length || !toast.current) return;
    toast.current.show(notices.map((notice) => ({
      severity: notice.severity,
      summary: t(`feedback.${notice.severity}`),
      detail: t(notice.key),
      life: notice.severity === "success" ? 5000 : 9000,
      closable: true,
    })));
    consume(notices.map((notice) => notice.id));
  }, [notices, consume, t]);
  return <Toast ref={toast} position={i18n.language.startsWith("ar") ? "top-left" : "top-right"} baseZIndex={10000} />;
}
