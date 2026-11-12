import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
const ImportDialog = lazy(() => import("./ImportDialog"));
export function ImportButton({ kind }: { kind: "items" | "parties" }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        label={t("imports.open")}
        icon="pi pi-file-excel"
        outlined
        onClick={() => setOpen(true)}
      />
      {open ? (
        <Suspense fallback={<p role="status">{t("status.loading")}</p>}>
          <ImportDialog kind={kind} onHide={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
