import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import type { ExportFormat } from "../../features/accounting/export-report";

export interface ExportButtonsProps {
  readonly onExport: (format: ExportFormat) => Promise<void>;
}

// Shared by every report screen with a server-side export (trial balance, balance
// sheet, income statement) so the loading-state handling for "which of the two
// buttons is currently downloading" isn't reimplemented per page.
export function ExportButtons({ onExport }: ExportButtonsProps): React.JSX.Element {
  const { t } = useTranslation();
  const [loadingFormat, setLoadingFormat] = useState<ExportFormat | null>(null);

  const handleClick = async (format: ExportFormat) => {
    setLoadingFormat(format);
    try {
      await onExport(format);
    } finally {
      setLoadingFormat(null);
    }
  };

  return (
    <div className="erp-export-buttons">
      <Button
        type="button"
        label={t("actions.exportPdf")}
        icon="pi pi-file-pdf"
        outlined
        loading={loadingFormat === "pdf"}
        disabled={loadingFormat !== null && loadingFormat !== "pdf"}
        onClick={() => void handleClick("pdf")}
      />
      <Button
        type="button"
        label={t("actions.exportCsv")}
        icon="pi pi-file"
        outlined
        loading={loadingFormat === "csv"}
        disabled={loadingFormat !== null && loadingFormat !== "csv"}
        onClick={() => void handleClick("csv")}
      />
    </div>
  );
}
