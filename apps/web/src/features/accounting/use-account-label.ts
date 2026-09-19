import { useTranslation } from "react-i18next";
import { localizedName } from "../../shared/lib/localized-name";
import { useChartOfAccounts } from "./use-chart-of-accounts";

// Report and journal-entry lines come back from the API as accountId + English
// accountName. This resolves the display name in the current language from the
// chart of accounts (already cached for the Chart screen and account pickers), so the
// reporting queries themselves stay language-agnostic.
export function useAccountLabel(): (accountId: string, fallbackName: string) => string {
  const { i18n } = useTranslation();
  const { data } = useChartOfAccounts();
  const byId = new Map((data ?? []).map((a) => [a.id, a]));

  return (accountId, fallbackName) => {
    const account = byId.get(accountId);
    return account ? localizedName(account, i18n.language) : fallbackName;
  };
}
