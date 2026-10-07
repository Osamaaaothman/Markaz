import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { localizedName } from "../../shared/lib/localized-name";
import { useDebouncedValue } from "../../shared/lib/use-debounced-value";
import { CopyId } from "../../shared/ui/CopyId";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useWarehouses, type WarehouseSummary } from "./use-warehouses";
import { WarehouseFormDialog } from "./WarehouseFormDialog";

export function WarehousesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialogWarehouse, setDialogWarehouse] = useState<WarehouseSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const debouncedQuery = useDebouncedValue(query);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useWarehouses({
    q: debouncedQuery,
    includeInactive,
  });
  const warehouses = data?.pages.flatMap((page) => page.data) ?? [];

  const openDialog = (warehouse: WarehouseSummary | null): void => {
    setDialogWarehouse(warehouse);
    setDialogOpen(true);
  };

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("inventory.warehouses.title")}</h1>
          <p className="erp-page__subtitle">{t("inventory.warehouses.subtitle")}</p>
        </div>
        <PermissionButton
          allowed={can("warehouse:create")}
          label={t("inventory.warehouses.add")}
          icon="pi pi-plus"
          onClick={() => openDialog(null)}
        />
      </div>

      <div className="coa-toolbar">
        <div className="coa-search">
          <InputText
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("inventory.warehouses.searchPlaceholder")}
            aria-label={t("inventory.warehouses.searchPlaceholder")}
          />
        </div>
        <label className="coa-levels" htmlFor="warehousesInactive">
          <InputSwitch inputId="warehousesInactive" checked={includeInactive} onChange={(e) => setIncludeInactive(Boolean(e.value))} />
          <span className="coa-levels__label">{t("inventory.warehouses.showInactive")}</span>
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
          <DataTable value={warehouses} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
            <Column field="code" header={t("inventory.warehouses.code")} style={{ width: "8rem" }} body={(row: WarehouseSummary) => <span className="coa-code">{row.code}</span>} />
            <Column header={t("inventory.warehouses.name")} body={(row: WarehouseSummary) => <span className="coa-name">{localizedName(row, i18n.language)}</span>} />
            <Column header={t("inventory.id")} style={{ width: "8rem" }} body={(row: WarehouseSummary) => <CopyId value={row.ref} uuid={row.id} />} />
            <Column
              header={t("inventory.warehouses.status")}
              style={{ width: "8rem" }}
              body={(row: WarehouseSummary) => (
                <Tag value={row.isActive ? t("inventory.warehouses.active") : t("inventory.warehouses.inactive")} severity={row.isActive ? "success" : "warning"} />
              )}
            />
            <Column
              header=""
              style={{ width: "4rem" }}
              body={(row: WarehouseSummary) => (
                <PermissionButton
                  allowed={can("warehouse:update")}
                  icon="pi pi-pencil"
                  rounded
                  text
                  severity="secondary"
                  aria-label={t("inventory.warehouses.edit")}
                  onClick={() => openDialog(row)}
                />
              )}
            />
          </DataTable>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}

      <WarehouseFormDialog warehouse={dialogWarehouse} visible={dialogOpen} onHide={() => setDialogOpen(false)} />
    </div>
  );
}
