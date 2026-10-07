import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";
import { downloadBlob } from "../../shared/lib/download-file";

export type AttachmentOwnerType = "SALES_INVOICE" | "SUPPLIER_INVOICE" | "PAYMENT" | "JOURNAL_ENTRY" | "PURCHASE_ORDER" | "PARTY" | "ITEM" | "COMPANY";
export const ATTACHMENT_OWNER_TYPES: readonly AttachmentOwnerType[] = ["SALES_INVOICE", "SUPPLIER_INVOICE", "PAYMENT", "JOURNAL_ENTRY", "PURCHASE_ORDER", "PARTY", "ITEM", "COMPANY"];

export interface AttachmentSummary {
  readonly id: string;
  readonly ownerType: AttachmentOwnerType;
  readonly ownerId: string;
  readonly ownerLabel: string | null;
  readonly visibility: "PRIVATE" | "PUBLIC";
  readonly originalName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly createdByEmail: string | null;
  readonly publicUrl: string | null;
}

interface Page<T> {
  readonly data: readonly T[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

// The same limits the API enforces. Checked here too so a wrong file is refused before it is sent.
export const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function useOwnerAttachments(ownerType: AttachmentOwnerType, ownerId: string, enabled = true) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["attachments", "owner", ownerType, ownerId],
    queryFn: async () => (await apiClient.get<AttachmentSummary[]>("/v1/attachments", { params: { ownerType, ownerId } })).data,
    enabled: enabled && can("attachment:read"),
    staleTime: 5_000,
  });
}

export function useAllAttachments(ownerType: AttachmentOwnerType | null, q: string) {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["attachments", "all", ownerType, q],
    queryFn: async ({ pageParam }) =>
      (await apiClient.get<Page<AttachmentSummary>>("/v1/attachments", { params: { limit: "50", ...(ownerType ? { ownerType } : {}), ...(q ? { q } : {}), ...(pageParam ? { cursor: pageParam } : {}) } })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("attachment:read"),
  });
}

export interface UploadArgs {
  readonly file: File;
  readonly ownerType: AttachmentOwnerType;
  readonly ownerId: string;
  readonly onProgress?: (percent: number) => void;
}

export function useUploadAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, ownerType, ownerId, onProgress }: UploadArgs) => {
      const form = new FormData();
      // Text fields first: the server reads them before the file stream ends.
      form.append("ownerType", ownerType);
      form.append("ownerId", ownerId);
      form.append("file", file);
      return (
        await apiClient.post<AttachmentSummary>("/v1/attachments", form, {
          onUploadProgress: (event) => {
            if (event.total && onProgress) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
          },
        })
      ).data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["attachments"] }),
  });
}

export function useRemoveAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await apiClient.delete<{ removed: true }>(`/v1/attachments/${id}`)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["attachments"] }),
  });
}

// The file travels through the API with the user's own token, so it is fetched as a blob and handed to the
// browser from memory; there is no link that works without being signed in.
export async function fetchAttachmentBlob(id: string, download: boolean): Promise<Blob> {
  return (await apiClient.get<Blob>(`/v1/attachments/${id}/content`, { params: download ? { download: "true" } : {}, responseType: "blob" })).data;
}

export async function downloadAttachment(id: string, name: string): Promise<void> {
  downloadBlob(await fetchAttachmentBlob(id, true), name);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
