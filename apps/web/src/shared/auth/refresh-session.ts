interface RefreshDependencies {
  synchronize(): Promise<void>;
  accessToken(): string | null;
  refresh(): Promise<string | null>;
  lock<T>(work: () => Promise<T>): Promise<T>;
  sameUser(previous: string, current: string): boolean;
}

export interface RefreshResult {
  readonly token: string | null;
  readonly clear: boolean;
}

// Coordinate both simultaneous requests in one tab and token rotation in other tabs.
export function createSessionRefresher(
  deps: RefreshDependencies,
): (failedToken: string | null) => Promise<RefreshResult> {
  let pending: Promise<RefreshResult> | null = null;
  return (failedToken) => {
    pending ??= deps
      .lock(async () => {
        await deps.synchronize();
        const current = deps.accessToken();
        if (!current) return { token: null, clear: false };
        if (current !== failedToken) {
          return {
            token: failedToken && deps.sameUser(failedToken, current) ? current : null,
            clear: false,
          };
        }
        const token = await deps.refresh();
        await deps.synchronize();
        return { token, clear: token === null && deps.accessToken() === current };
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
