import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { downloadAttachment, fetchAttachmentBlob } from "./use-attachments";

export interface ViewedFile {
  readonly id: string;
  readonly originalName: string;
  readonly contentType: string;
}

// Shows an attached file inside the app, in a window over the current screen: a PDF in the browser's own PDF viewer,
// a picture as an image. The file is fetched through the API with the user's token and shown from memory (a blob),
// so nothing is opened in another tab and there is no link that works without signing in.
export function AttachmentViewer({ file, onHide }: { readonly file: ViewedFile | null; readonly onHide: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!file) return undefined;
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    fetchAttachmentBlob(file.id, false)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file?.id]);

  const isPdf = file?.contentType === "application/pdf";

  return (
    <Dialog
      visible={file !== null}
      onHide={onHide}
      className="mk-viewer"
      modal
      dismissableMask
      maximizable
      header={
        <span className="mk-viewer__title" dir="auto">
          {file?.originalName ?? ""}
        </span>
      }
      footer={
        file ? (
          <Button type="button" icon="pi pi-download" label={t("attachments.download")} outlined onClick={() => void downloadAttachment(file.id, file.originalName)} />
        ) : undefined
      }
    >
      <div className="mk-viewer__stage">
        {failed ? (
          <p className="erp-auth-card__error">{t("attachments.errors.generic")}</p>
        ) : !url ? (
          <i className="pi pi-spin pi-spinner" aria-label={t("status.loading")} />
        ) : isPdf ? (
          <iframe src={url} title={file?.originalName ?? ""} className="mk-viewer__frame" />
        ) : (
          <img src={url} alt={file?.originalName ?? ""} className="mk-viewer__image" />
        )}
      </div>
    </Dialog>
  );
}
