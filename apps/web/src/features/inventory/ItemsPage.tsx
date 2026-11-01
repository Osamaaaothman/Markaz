import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataGrid } from "../../shared/ui/DataGrid";
import { ApiImage } from "../../shared/ui/ApiImage";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { localizedName } from "../../shared/lib/localized-name";
import { useDebouncedValue } from "../../shared/lib/use-debounced-value";
import { CopyId } from "../../shared/ui/CopyId";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { ItemFormDialog } from "./ItemFormDialog";
import { useItems, type ItemSummary } from "./use-items";

export function ItemsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialogItem, setDialogItem] = useState<ItemSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const debouncedQuery = useDebouncedValue(query);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useItems({
    q: debouncedQuery,
    includeInactive,
  });
  const items = data?.pages.flatMap((page) => page.data) ?? [];

  const openDialog = (item: ItemSummary | null): void => {
    setDialogItem(item);
    setDialogOpen(true);
  };

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("inventory.items.title")}</h1>
          <p className="erp-page__subtitle">{t("inventory.items.subtitle")}</p>
        </div>
        <PermissionButton allowed={can("item:create")} label={t("inventory.items.add")} icon="pi pi-plus" onClick={() => openDialog(null)} />
      </div>

      <div className="coa-toolbar">
        <div className="coa-search">
          <InputText value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("inventory.items.searchPlaceholder")} aria-label={t("inventory.items.searchPlaceholder")} />
        </div>
        <label className="coa-levels" htmlFor="itemsInactive">
          <InputSwitch inputId="itemsInactive" checked={includeInactive} onChange={(e) => setIncludeInactive(Boolean(e.value))} />
          <span className="coa-levels__label">{t("inventory.items.showInactive")}</span>
        </label>
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
          <DataGrid searchable={false} value={items} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
            <Column header="" style={{ width: "4rem" }} body={(row: ItemSummary) => <ApiImage path={row.pictureId ? `/v1/items/${row.id}/picture` : null} version={row.pictureId} className="mk-thumb" fallback={<span className="mk-thumb mk-thumb--empty"><i className="pi pi-image" aria-hidden="true" /></span>} />} />
            <Column field="code" header={t("inventory.items.code")} style={{ width: "8rem" }} body={(row: ItemSummary) => <span className="coa-code">{row.code}</span>} />
            <Column header={t("inventory.items.name")} body={(row: ItemSummary) => <span className="coa-name">{localizedName(row, i18n.language)}</span>} />
            <Column field="unit" header={t("inventory.items.unit")} style={{ width: "6rem" }} />
            <Column header={t("inventory.items.reorderPoint")} style={{ width: "8rem" }} align="right" body={(row: ItemSummary) => <span className="coa-amount">{row.reorderPoint}</span>} />
            <Column header={t("inventory.id")} style={{ width: "8rem" }} body={(row: ItemSummary) => <CopyId value={row.ref} uuid={row.id} />} />
            <Column
              header={t("inventory.items.status")}
              style={{ width: "8rem" }}
              body={(row: ItemSummary) => <Tag value={row.isActive ? t("inventory.items.active") : t("inventory.items.inactive")} severity={row.isActive ? "success" : "warning"} />}
            />
            <Column
              header=""
              style={{ width: "4rem" }}
              body={(row: ItemSummary) => (
                <PermissionButton allowed={can("item:update")} icon="pi pi-pencil" rounded text severity="secondary" aria-label={t("inventory.items.edit")} onClick={() => openDialog(row)} />
              )}
            />
          </DataGrid>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}

      <ItemFormDialog item={dialogItem} visible={dialogOpen} onHide={() => setDialogOpen(false)} />
    </div>
  );
}
