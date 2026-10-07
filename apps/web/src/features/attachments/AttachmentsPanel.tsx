import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AxiosError } from "axios";
import { Button } from "primereact/button";
import { usePermissions } from "../../shared/auth/use-permissions";
import { AttachmentViewer, type ViewedFile } from "./AttachmentViewer";
import {
  ACCEPTED_TYPES,
  MAX_UPLOAD_BYTES,
  downloadAttachment,
  formatBytes,
  useOwnerAttachments,
  useRemoveAttachment,
  useUploadAttachment,
  type AttachmentOwnerType,
  type AttachmentSummary,
} from "./use-attachments";

interface UploadState {
  readonly name: string;
  readonly percent: number;
}

// Server error codes -> translation keys. Anything unknown falls back to the generic message.
const ERROR_KEYS: Readonly<Record<string, string>> = {
  UNSUPPORTED_FILE_TYPE: "attachments.errors.type",
  FILE_TOO_LARGE: "attachments.errors.size",
  EMPTY_FILE: "attachments.errors.empty",
  OWNER_NOT_FOUND: "attachments.errors.owner",
  FORBIDDEN_OWNER: "attachments.errors.forbidden",
};

function errorKey(error: unknown): string {
  if (error instanceof AxiosError) {
    // The API wraps every error as { error: { code, message } }.
    const code = (error.response?.data as { error?: { code?: string } } | undefined)?.error?.code;
    if (code && ERROR_KEYS[code]) return ERROR_KEYS[code];
    if (error.response?.status === 413) return "attachments.errors.size";
  }
  return "attachments.errors.generic";
}

function iconFor(contentType: string): string {
  return contentType === "application/pdf" ? "pi pi-file-pdf" : "pi pi-image";
}

// The documents attached to one record: drop or pick files to add, open or download, remove. Everything is
// permission-aware: without attachment:create there is no drop area, without attachment:delete no remove button.
export function AttachmentsPanel({ ownerType, ownerId }: { readonly ownerType: AttachmentOwnerType; readonly ownerId: string }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const { data, isPending, isError, refetch } = useOwnerAttachments(ownerType, ownerId);
  const upload = useUploadAttachment();
  const remove = useRemoveAttachment();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<readonly UploadState[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ViewedFile | null>(null);

  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  const send = async (files: FileList | File[]): Promise<void> => {
    setProblem(null);
    for (const file of Array.from(files)) {
      if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
        setProblem(t("attachments.errors.type"));
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setProblem(t("attachments.errors.size"));
        continue;
      }
      setUploads((current) => [...current, { name: file.name, percent: 0 }]);
      try {
        await upload.mutateAsync({
          file,
          ownerType,
          ownerId,
          onProgress: (percent) => setUploads((current) => current.map((u) => (u.name === file.name ? { ...u, percent } : u))),
        });
      } catch (error) {
        setProblem(t(errorKey(error)));
      } finally {
        setUploads((current) => current.filter((u) => u.name !== file.name));
      }
    }
  };

  const act = async (work: () => Promise<void>): Promise<void> => {
    setProblem(null);
    try {
      await work();
    } catch {
      setProblem(t("attachments.errors.generic"));
    }
  };

  const items: readonly AttachmentSummary[] = data ?? [];

  return (
    <div className="mk-attach">
      {can("attachment:create") ? (
        <div
          className={`mk-attach__drop${dragging ? " is-dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void send(e.dataTransfer.files);
          }}
        >
          <i className="pi pi-cloud-upload" aria-hidden="true" />
          <div>
            <strong>{t("attachments.dropTitle")}</strong>
            <span>{t("attachments.dropHint")}</span>
          </div>
          <Button type="button" label={t("attachments.choose")} icon="pi pi-paperclip" outlined onClick={() => input.current?.click()} />
          <input
            ref={input}
            type="file"
            hidden
            multiple
            accept={ACCEPTED_TYPES.join(",")}
            onChange={(e) => {
              if (e.target.files) void send(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      ) : null}

      {uploads.map((u) => (
        <div key={u.name} className="mk-attach__uploading" role="status">
          <i className="pi pi-spin pi-spinner" aria-hidden="true" />
          <span dir="ltr">{u.name}</span>
          <div className="mk-export__bar mk-attach__bar">
            <span style={{ inlineSize: `${u.percent}%` }} />
          </div>
          <small>{u.percent}%</small>
        </div>
      ))}

      {problem ? (
        <p className="erp-auth-card__error" role="alert">
          {problem}
        </p>
      ) : null}

      {isPending && can("attachment:read") ? (
        <p className="mk-attach__empty">{t("status.loading")}</p>
      ) : isError ? (
        <p className="mk-attach__empty">
          {t("status.error")}{" "}
          <button type="button" className="erp-button-link" onClick={() => void refetch()}>
            {t("actions.retry")}
          </button>
        </p>
      ) : items.length === 0 ? (
        <p className="mk-attach__empty">{t("attachments.empty")}</p>
      ) : (
        <ul className="mk-attach__list">
          {items.map((file) => (
            <li key={file.id} className="mk-attach__item">
              <i className={iconFor(file.contentType)} aria-hidden="true" />
              <div className="mk-attach__meta">
                <strong dir="auto">{file.originalName}</strong>
                <small>
                  <bdi dir="ltr">{formatBytes(file.sizeBytes)}</bdi> · <bdi>{when.format(new Date(file.createdAt))}</bdi>
                  {file.createdByEmail ? (
                    <>
                      {" · "}
                      <bdi dir="ltr">{file.createdByEmail}</bdi>
                    </>
                  ) : null}
                </small>
              </div>
              <div className="mk-attach__actions">
                <Button type="button" icon="pi pi-eye" text rounded aria-label={t("attachments.open")} tooltip={t("attachments.open")} onClick={() => setViewing(file)} />
                <Button type="button" icon="pi pi-download" text rounded aria-label={t("attachments.download")} tooltip={t("attachments.download")} onClick={() => void act(() => downloadAttachment(file.id, file.originalName))} />
                {can("attachment:delete") ? (
                  confirming === file.id ? (
                    <>
                      <Button
                        type="button"
                        label={t("attachments.confirmRemove")}
                        severity="danger"
                        size="small"
                        loading={remove.isPending}
                        onClick={() => void act(async () => {
                          await remove.mutateAsync(file.id);
                          setConfirming(null);
                        })}
                      />
                      <Button type="button" label={t("actions.cancel")} text size="small" onClick={() => setConfirming(null)} />
                    </>
                  ) : (
                    <Button type="button" icon="pi pi-trash" text rounded severity="danger" aria-label={t("attachments.remove")} tooltip={t("attachments.remove")} onClick={() => setConfirming(file.id)} />
                  )
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <AttachmentViewer file={viewing} onHide={() => setViewing(null)} />
    </div>
  );
}
