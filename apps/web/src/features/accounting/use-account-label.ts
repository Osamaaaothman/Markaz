import { useTranslation } from "react-i18next";
import { localizedName } from "../../shared/lib/localized-name";
import { useChartOfAccounts } from "./use-chart-of-accounts";

// Report and journal-entry lines come back from the API as accountId + English
// accountName. This resolves the display name in the current language from the
// chart of accounts (already cached for the Chart screen and account pickers), so the
// reporting queries themselves stay language-agnostic.
// PrimeReact tables do not re-render their cells when data arrives after the first paint, so a report opened with a
// cold chart cache kept the English fallback names for good. Used as the table's `key`, this remounts the table
// once the chart has loaded and when the language changes.
export function useAccountLabelKey(): string {
  const { i18n } = useTranslation();
  const { data } = useChartOfAccounts(true);
  return `${i18n.language}:${data ? "ready" : "loading"}`;
}

export function useAccountLabel(): (accountId: string, fallbackName: string) => string {
  const { i18n } = useTranslation();
  const { data } = useChartOfAccounts(true);
  const byId = new Map((data ?? []).map((a) => [a.id, a]));

  return (accountId, fallbackName) => {
    const account = byId.get(accountId);
    return account ? localizedName(account, i18n.language) : fallbackName;
  };
}
