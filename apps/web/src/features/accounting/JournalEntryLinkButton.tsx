import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { usePermissions } from "../../shared/auth/use-permissions";
import { JournalEntryDetailDialog } from "./JournalEntryDetailDialog";

// "View the journal entry" for a document that posted one. Shown only to someone who may read journal entries.
export function JournalEntryLinkButton({ entryId }: { readonly entryId: string }): React.JSX.Element | null {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  if (!can("journal_entry:read")) return null;
  return (
    <>
      <Button type="button" label={t("documents.journalEntry")} icon="pi pi-book" severity="secondary" outlined onClick={() => setOpen(true)} />
      <JournalEntryDetailDialog entryId={open ? entryId : null} onHide={() => setOpen(false)} />
    </>
  );
}
