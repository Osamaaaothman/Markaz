import { apiClient } from "../../shared/api/client";
import { downloadBlob } from "../../shared/lib/download-file";

export type ExportFormat = "csv" | "pdf";

export async function exportReport(
  path: string,
  params: Record<string, string>,
  filenameBase: string,
  format: ExportFormat,
): Promise<void> {
  const response = await apiClient.get<Blob>(path, {
    params: { ...params, format },
    responseType: "blob",
  });
  downloadBlob(response.data, `${filenameBase}.${format}`);
}
