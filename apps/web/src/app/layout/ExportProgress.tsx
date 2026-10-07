import { useTranslation } from "react-i18next";
import { useExportStore } from "../../shared/lib/export-store";

// Bottom-corner panel listing the exports in flight. Announced politely to screen readers.
export function ExportProgress(): React.JSX.Element | null {
  const { t } = useTranslation();
  const jobs = useExportStore((state) => state.jobs);
  const dismiss = useExportStore((state) => state.dismiss);
  if (jobs.length === 0) return null;

  return (
    <div className="mk-exports" role="status" aria-live="polite">
      {jobs.map((job) => (
        <div key={job.id} className={`mk-export mk-export--${job.state}`}>
          <i
            className={job.state === "done" ? "pi pi-check-circle" : job.state === "error" ? "pi pi-exclamation-circle" : "pi pi-spin pi-spinner"}
            aria-hidden="true"
          />
          <div className="mk-export__body">
            <strong dir="ltr" className="mk-export__name">
              {job.filename}
            </strong>
            <span className="mk-export__status">
              {job.state === "done" ? t("exportProgress.done") : job.state === "error" ? t("exportProgress.failed") : job.percent === null ? t("exportProgress.preparing") : t("exportProgress.downloading", { percent: job.percent })}
            </span>
            {job.state === "running" ? (
              <div className={`mk-export__bar${job.percent === null ? " mk-export__bar--indeterminate" : ""}`}>
                <span style={job.percent === null ? undefined : { inlineSize: `${job.percent}%` }} />
              </div>
            ) : null}
          </div>
          {job.state === "error" ? (
            <button type="button" className="mk-export__close" onClick={() => dismiss(job.id)} aria-label={t("exportProgress.dismiss")}>
              <i className="pi pi-times" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
