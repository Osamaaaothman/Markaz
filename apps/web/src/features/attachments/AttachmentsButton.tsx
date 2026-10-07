import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { usePermissions } from "../../shared/auth/use-permissions";
import { AttachmentsPanel } from "./AttachmentsPanel";
import type { AttachmentOwnerType } from "./use-attachments";

// A paperclip for a table row or a page header: opens the documents attached to that record in a dialog.
// Hidden for a user who may not read attachments at all.
export function AttachmentsButton({
  ownerType,
  ownerId,
  label,
}: {
  readonly ownerType: AttachmentOwnerType;
  readonly ownerId: string;
  // What the record is called (an invoice number), shown in the dialog title.
  readonly label?: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  if (!can("attachment:read")) return null;

  return (
    <>
      <Button
        type="button"
        icon="pi pi-paperclip"
        text
        rounded
        severity="secondary"
        aria-label={t("attachments.title")}
        tooltip={t("attachments.title")}
        onClick={(e) => {
          // Inside a clickable table row: do not also open the row.
          e.stopPropagation();
          setOpen(true);
        }}
      />
      <Dialog
        visible={open}
        onHide={() => setOpen(false)}
        header={label ? `${t("attachments.title")} — ${label}` : t("attachments.title")}
        className="erp-dialog"
        modal
        dismissableMask
      >
        <AttachmentsPanel ownerType={ownerType} ownerId={ownerId} />
      </Dialog>
    </>
  );
}
