import { useTranslation } from "react-i18next";
import { Dropdown } from "primereact/dropdown";
import { Tag } from "primereact/tag";
import { localizedName } from "../../shared/lib/localized-name";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useChartOfAccounts } from "../accounting/use-chart-of-accounts";
import { ACCOUNT_MAPPING_KEYS, useAccountMappings, useSetAccountMapping, type AccountMappingKey } from "./use-account-mappings";

const NOT_MAPPED = "__none__";

export function AccountMappingPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data: mappings, isPending, isError, refetch } = useAccountMappings();
  const { data: accounts } = useChartOfAccounts();
  const setMapping = useSetAccountMapping();

  // Only a leaf (postable) account can be posted to — the same rule the API enforces.
  const postableAccounts = (accounts ?? []).filter((a) => a.isPostable);

  if (isPending) return <PageSkeleton />;
  if (isError) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }

  const byKey = new Map(mappings?.map((m) => [m.key, m]));

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("inventory.accountMapping.title")}</h1>
          <p className="erp-page__subtitle">{t("inventory.accountMapping.subtitle")}</p>
        </div>
      </div>

      <div className="erp-form">
        {ACCOUNT_MAPPING_KEYS.map((key: AccountMappingKey) => {
          const entry = byKey.get(key);
          return (
            <div key={key} className="erp-field">
              <label htmlFor={`mapping-${key}`}>
                {t(`inventory.accountMapping.keys.${key}`)}
                {!entry?.accountId ? <Tag className="erp-mapping-unset" value={t("inventory.accountMapping.unset")} severity="warning" /> : null}
              </label>
              <small className="erp-field__hint">{t(`inventory.accountMapping.keyHints.${key}`)}</small>
              <Dropdown
                inputId={`mapping-${key}`}
                value={entry?.accountId ?? NOT_MAPPED}
                onChange={(e) => {
                  if (e.value === NOT_MAPPED) return;
                  setMapping.mutate({ key, accountId: e.value as string });
                }}
                options={[
                  { label: t("inventory.accountMapping.unset"), value: NOT_MAPPED },
                  ...postableAccounts.map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id })),
                ]}
                filter
              />
            </div>
          );
        })}
        {setMapping.isError ? <p className="erp-auth-card__error">{t("inventory.accountMapping.updateError")}</p> : null}
      </div>
    </div>
  );
}
