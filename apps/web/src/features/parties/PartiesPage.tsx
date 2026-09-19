import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { localizedName } from "../../shared/lib/localized-name";
import { useDebouncedValue } from "../../shared/lib/use-debounced-value";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { PartyFormDialog } from "./PartyFormDialog";
import { partyKindIcon } from "./party-kind";
import { PARTY_KINDS, useParties, type PartyKind, type PartySummary } from "./use-parties";

export function PartiesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<PartyKind | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialogParty, setDialogParty] = useState<PartySummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const debouncedQuery = useDebouncedValue(query);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useParties({
    q: debouncedQuery,
    kind,
    includeInactive,
  });
  const parties = data?.pages.flatMap((page) => page.data) ?? [];

  const openDialog = (party: PartySummary | null): void => {
    setDialogParty(party);
    setDialogOpen(true);
  };

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("parties.title")}</h1>
          <p className="erp-page__subtitle">{t("parties.subtitle")}</p>
        </div>
        <PermissionButton
          allowed={can("party:create")}
          label={t("parties.add")}
          icon="pi pi-plus"
          onClick={() => openDialog(null)}
        />
      </div>

      <div className="coa-toolbar">
        <div className="coa-search">
          <InputText
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("parties.searchPlaceholder")}
            aria-label={t("parties.searchPlaceholder")}
          />
        </div>
        <div className="coa-levels">
          <Dropdown
            value={kind}
            onChange={(e) => setKind((e.value as PartyKind | null) ?? null)}
            options={[
              { label: t("parties.allKinds"), value: null },
              ...PARTY_KINDS.map((k) => ({ label: t(`parties.kinds.${k}`), value: k })),
            ]}
            aria-label={t("parties.kind")}
          />
          <label className="coa-levels" htmlFor="partiesInactive">
            <InputSwitch inputId="partiesInactive" checked={includeInactive} onChange={(e) => setIncludeInactive(Boolean(e.value))} />
            <span className="coa-levels__label">{t("parties.showInactive")}</span>
          </label>
        </div>
      </div>

      {isPending ? (
        <PageSkeleton />
      ) : isError ? (
        <div className="erp-page">
          <p className="erp-page__error">{t("status.error")}</p>
          <button type="button" className="erp-button-link" onClick={() => void refetch()}>
            {t("actions.retry")}
          </button>
        </div>
      ) : (
        <>
          <DataTable
            value={parties}
            className="erp-table"
            stripedRows
            showGridlines
            size="small"
            emptyMessage={query.trim() ? t("parties.noResults") : t("status.empty")}
          >
            <Column
              header={t("parties.name")}
              body={(row: PartySummary) => (
                <span className="coa-cell" style={{ paddingInlineStart: 0 }}>
                  <i className={`${partyKindIcon(row.kind)} coa-icon`} aria-hidden="true" />
                  <span className="coa-name">{localizedName(row, i18n.language)}</span>
                </span>
              )}
            />
            <Column
              header={t("parties.kind")}
              style={{ width: "9rem" }}
              body={(row: PartySummary) => <Tag value={t(`parties.kinds.${row.kind}`, row.kind)} severity="secondary" />}
            />
            <Column
              header={t("parties.phone")}
              headerClassName="coa-col-hide-sm"
              bodyClassName="coa-col-hide-sm"
              body={(row: PartySummary) => (row.phone ? <span className="coa-code">{row.phone}</span> : null)}
            />
            <Column
              header={t("parties.email")}
              headerClassName="coa-col-hide-sm"
              bodyClassName="coa-col-hide-sm"
              body={(row: PartySummary) => (row.email ? <span className="coa-code">{row.email}</span> : null)}
            />
            <Column
              header={t("parties.status")}
              style={{ width: "8rem" }}
              body={(row: PartySummary) => (
                <Tag value={row.isActive ? t("parties.active") : t("parties.inactive")} severity={row.isActive ? "success" : "warning"} />
              )}
            />
            <Column
              header=""
              style={{ width: "8rem" }}
              body={(row: PartySummary) => (
                <PermissionButton
                  allowed={can("party:update")}
                  label={t("parties.edit")}
                  icon="pi pi-pencil"
                  text
                  size="small"
                  onClick={() => openDialog(row)}
                />
              )}
            />
          </DataTable>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button
                label={t("actions.loadMore")}
                text
                onClick={() => void fetchNextPage()}
                loading={isFetchingNextPage}
                icon="pi pi-chevron-down"
              />
            </div>
          ) : null}
        </>
      )}

      <PartyFormDialog party={dialogParty} visible={dialogOpen} onHide={() => setDialogOpen(false)} />
    </div>
  );
}
