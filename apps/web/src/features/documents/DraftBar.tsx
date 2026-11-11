import { Button } from "primereact/button";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export function DraftBar({
  draft,
}: {
  draft: { status: string; save(): Promise<boolean>; dirty: boolean };
}): React.JSX.Element {
  const { t } = useTranslation(),
    navigate = useNavigate();
  return (
    <div className="erp-draft-bar">
      <span
        role="status"
        aria-live="polite"
        className={
          draft.status === "error" || draft.status === "conflict" ? "erp-field__error" : ""
        }
      >
        {t(`drafts.${draft.dirty && draft.status === "saved" ? "pending" : draft.status}`)}
      </span>
      <Button
        type="button"
        text
        icon="pi pi-save"
        label={t("drafts.save")}
        loading={draft.status === "saving"}
        disabled={["loading", "conflict", "completed"].includes(draft.status)}
        onClick={() => {
          void draft.save();
        }}
      />
      <Button
        type="button"
        text
        label={t("drafts.title")}
        onClick={() => {
          void (async () => {
            if (!draft.dirty || (await draft.save())) void navigate("/documents/drafts");
          })();
        }}
      />
    </div>
  );
}
