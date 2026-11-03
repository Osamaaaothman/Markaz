import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface SetupStep {
  readonly key: string;
  readonly required: boolean;
  readonly done: boolean;
  readonly progress: { readonly done: number; readonly total: number } | null;
  readonly link: string;
}

export interface SetupStatus {
  readonly steps: readonly SetupStep[];
  readonly requiredDone: boolean;
}

export interface MappingSuggestion {
  readonly key: string;
  readonly action: "MAP_EXISTING" | "MAP_FOLDER" | "CREATE_UNDER";
  readonly folderCode: string;
  readonly folderName: string;
  readonly folderNameAr: string | null;
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountNameAr: string | null;
}

export interface ApplySuggestionResult {
  readonly key: string;
  readonly status: "APPLIED" | "SKIPPED";
  readonly reason?: string;
}

export function useSetupStatus() {
  const { can } = usePermissions();
  return useQuery({ queryKey: ["setup", "status"], queryFn: async () => (await apiClient.get<SetupStatus>("/v1/setup/status")).data, staleTime: 10_000, enabled: can("account_mapping:read") });
}

export function useMappingSuggestions() {
  const { can } = usePermissions();
  return useQuery({ queryKey: ["setup", "suggestions"], queryFn: async () => (await apiClient.get<MappingSuggestion[]>("/v1/setup/mapping-suggestions")).data, staleTime: 10_000, enabled: can("account_mapping:read") });
}

export function useApplySuggestions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (keys: readonly string[]) => (await apiClient.post<ApplySuggestionResult[]>("/v1/setup/mapping-suggestions/apply", { keys })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      void qc.invalidateQueries({ queryKey: ["accountMappings"] });
      void qc.invalidateQueries({ queryKey: ["chartOfAccounts"] });
    },
  });
}
