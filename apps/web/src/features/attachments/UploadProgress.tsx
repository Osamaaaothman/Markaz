import { useTranslation } from "react-i18next";

// What a file being sent looks like, everywhere a file is uploaded: a spinner, the name, a bar and the percentage.
// At 99% the bytes are all sent and the server is still storing the file, which reads as "saving".
export function UploadProgress({ name, percent }: { readonly name: string; readonly percent: number }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="mk-attach__uploading" role="status" aria-live="polite">
      <i className="pi pi-spin pi-spinner" aria-hidden="true" />
      <span className="mk-attach__uploading-name" dir="ltr">
        {name}
      </span>
      <div className="mk-export__bar mk-attach__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ inlineSize: `${percent}%` }} />
      </div>
      <strong className="mk-attach__percent">{percent >= 99 ? t("attachments.saving") : `${percent}%`}</strong>
    </div>
  );
}
