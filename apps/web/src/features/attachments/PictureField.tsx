import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AxiosError } from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "primereact/button";
import { usePermissions } from "../../shared/auth/use-permissions";
import { ApiImage } from "../../shared/ui/ApiImage";
import { useRemoveAttachment, useUploadAttachment, type AttachmentOwnerType } from "./use-attachments";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

// One picture for one record: an item's photo or the company logo. Shows it, lets the right people replace or
// remove it, and says why when the file is refused. The previous picture is removed after the new one is stored, so
// a failed upload never leaves the record without its picture.
export function PictureField({
  ownerType,
  ownerId,
  imagePath,
  currentPictureId,
  canChange,
  label,
  onChanged,
}: {
  readonly ownerType: Extract<AttachmentOwnerType, "ITEM" | "COMPANY">;
  readonly ownerId: string;
  // Where the current picture is served from (item picture or company logo endpoint).
  readonly imagePath: string;
  readonly currentPictureId: string | null;
  readonly canChange: boolean;
  readonly label: string;
  readonly onChanged?: (pictureId: string | null) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const upload = useUploadAttachment();
  const remove = useRemoveAttachment();
  const input = useRef<HTMLInputElement>(null);
  const [pictureId, setPictureId] = useState<string | null>(currentPictureId);
  const [problem, setProblem] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const busy = percent !== null || remove.isPending;
  const allowed = canChange && can("attachment:create");

  const changed = (id: string | null): void => {
    setPictureId(id);
    onChanged?.(id);
    void queryClient.invalidateQueries({ queryKey: ["items"] });
    void queryClient.invalidateQueries({ queryKey: ["attachments"] });
    void queryClient.invalidateQueries({ queryKey: ["api-image"] });
  };

  const send = async (file: File): Promise<void> => {
    setProblem(null);
    if (!IMAGE_TYPES.includes(file.type)) return setProblem(t("attachments.errors.imageType"));
    if (file.size > MAX_BYTES) return setProblem(t("attachments.errors.size"));
    setPercent(0);
    try {
      const created = await upload.mutateAsync({ file, ownerType, ownerId, onProgress: setPercent });
      const previous = pictureId;
      changed(created.id);
      // The new picture is already the current one; tidy up the old one. A failure here is harmless.
      if (previous && can("attachment:delete")) await remove.mutateAsync(previous).catch(() => undefined);
    } catch (error) {
      const code = error instanceof AxiosError ? (error.response?.data as { error?: { code?: string } } | undefined)?.error?.code : undefined;
      setProblem(code === "UNSUPPORTED_FILE_TYPE" ? t("attachments.errors.imageType") : code === "FORBIDDEN_OWNER" ? t("attachments.errors.forbidden") : t("attachments.errors.generic"));
    } finally {
      setPercent(null);
    }
  };

  return (
    <div className="mk-picture">
      <div className="mk-picture__preview">
        <ApiImage path={pictureId ? imagePath : null} version={pictureId} alt={label} fallback={<i className="pi pi-image" aria-hidden="true" />} />
      </div>
      <div className="mk-picture__body">
        <strong>{label}</strong>
        {percent !== null ? (
          <div className="mk-export__bar mk-attach__bar">
            <span style={{ inlineSize: `${percent}%` }} />
          </div>
        ) : (
          <small>{pictureId ? t("attachments.pictureSet") : t("attachments.pictureNone")}</small>
        )}
        {allowed ? (
          <div className="mk-picture__actions">
            <Button type="button" size="small" outlined icon="pi pi-upload" label={pictureId ? t("attachments.replacePicture") : t("attachments.uploadPicture")} disabled={busy} onClick={() => input.current?.click()} />
            {pictureId && can("attachment:delete") ? (
              <Button
                type="button"
                size="small"
                text
                severity="danger"
                icon="pi pi-trash"
                label={t("attachments.removePicture")}
                disabled={busy}
                onClick={() => {
                  setProblem(null);
                  remove.mutate(pictureId, { onSuccess: () => changed(null), onError: () => setProblem(t("attachments.errors.generic")) });
                }}
              />
            ) : null}
            <input
              ref={input}
              type="file"
              hidden
              accept={IMAGE_TYPES.join(",")}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void send(file);
                e.target.value = "";
              }}
            />
          </div>
        ) : null}
        {problem ? (
          <p className="erp-auth-card__error" role="alert">
            {problem}
          </p>
        ) : null}
      </div>
    </div>
  );
}
