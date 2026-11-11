import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "primereact/dropdown";
import { usePermissions } from "../../shared/auth/use-permissions";
import { localizedName } from "../../shared/lib/localized-name";
import { useDebouncedValue } from "../../shared/lib/use-debounced-value";
import { usePartySearch } from "../parties/use-parties";
import { partyPickerOptions } from "../parties/party-picker-options";

interface PartyLike {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly kind: string;
}

// Picks the party an account is kept for. Searches the server as the user types (the party list
// can be long), keeps the currently selected eligible party in the list, and renders nothing for
// a user who may not read parties — the field simply is not offered.
export function PartyPicker({
  inputId,
  value,
  current,
  excludeEmployees = false,
  onChange,
}: {
  inputId: string;
  value: string | null;
  // The party already linked (from the account), so it stays selectable even when it is not in
  // the current search results.
  current?: PartyLike | null;
  // Customer/supplier fields exclude employees; account links keep all kinds.
  excludeEmployees?: boolean;
  onChange: (party: PartyLike | null) => void;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const [typed, setTyped] = useState("");
  const query = useDebouncedValue(typed);
  const { data: results } = usePartySearch(query, excludeEmployees);

  const parties = useMemo(
    () => partyPickerOptions<PartyLike>(results, current, excludeEmployees),
    [results, current, excludeEmployees],
  );

  if (!can("party:read")) return null;

  const options = parties.map((party) => ({
    label: `${localizedName(party, i18n.language)} · ${t(`parties.kinds.${party.kind}`, party.kind)}`,
    value: party.id,
    // Lets the dropdown's own filter also match the other language's name.
    searchText: `${party.name} ${party.nameAr ?? ""}`,
  }));

  return (
    <Dropdown
      inputId={inputId}
      value={value}
      options={options}
      optionLabel="label"
      optionValue="value"
      filter
      filterBy="searchText"
      filterPlaceholder={t("accounting.chartOfAccounts.partySearch")}
      onFilter={(e) => setTyped(e.filter)}
      showClear
      placeholder={t("accounting.chartOfAccounts.noParty")}
      emptyFilterMessage={t("parties.noResults")}
      onChange={(e) => onChange(parties.find((party) => party.id === e.value) ?? null)}
    />
  );
}
