import { useMemo } from "react";
import { useCurrentUser } from "./use-current-user";
import { hasAllPermissions, hasAnyPermission, hasPermission } from "./permissions";

export interface Permissions {
  // False until the profile (which carries the permission list) has loaded — until then
  // nothing is reported as allowed, so the UI never flashes actions the user cannot use.
  readonly isReady: boolean;
  readonly isError: boolean;
  readonly can: (code: string) => boolean;
  readonly canAny: (codes: readonly string[]) => boolean;
  readonly canAll: (codes: readonly string[]) => boolean;
}

export function usePermissions(): Permissions {
  const { data, isPending, isError } = useCurrentUser();
  const granted = useMemo(() => new Set(data?.permissions ?? []), [data]);

  return useMemo(
    () => ({
      isReady: !isPending && !isError,
      isError,
      can: (code) => hasPermission(granted, code),
      canAny: (codes) => hasAnyPermission(granted, codes),
      canAll: (codes) => hasAllPermissions(granted, codes),
    }),
    [granted, isPending, isError],
  );
}
