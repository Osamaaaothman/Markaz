// A missing start means the first day of the current year, a missing end means today (both in UTC, like every date here).
export function defaultTrialBalancePeriod(query: { readonly from?: string | undefined; readonly to?: string | undefined }): { from: Date; to: Date } {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return {
    from: query.from ? new Date(query.from) : new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
    to: query.to ? new Date(query.to) : today,
  };
}
