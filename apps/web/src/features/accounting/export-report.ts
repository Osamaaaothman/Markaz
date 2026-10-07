import { apiClient } from "../../shared/api/client";
import { downloadBlob } from "../../shared/lib/download-file";
import { useExportStore } from "../../shared/lib/export-store";

export type ExportFormat = "csv" | "pdf";

// Downloads a file from an authenticated endpoint and reports it to the progress panel the whole way:
// "preparing" while the server builds it, a percentage once it starts sending. Every export in the app goes
// through here, so the user always sees that something is happening.
export async function exportFile(path: string, params: Record<string, unknown>, filename: string): Promise<void> {
  const store = useExportStore.getState();
  const id = store.start(filename);
  try {
    const response = await apiClient.get<Blob>(path, {
      params,
      responseType: "blob",
      onDownloadProgress: (event) => {
        if (event.total && event.total > 0) store.progress(id, Math.min(99, Math.round((event.loaded / event.total) * 100)));
      },
    });
    downloadBlob(response.data, filename);
    store.finish(id);
  } catch (error) {
    store.fail(id);
    throw error;
  }
}

export async function exportReport(path: string, params: Record<string, string>, filenameBase: string, format: ExportFormat): Promise<void> {
  await exportFile(path, { ...params, format }, `${filenameBase}.${format}`);
}
