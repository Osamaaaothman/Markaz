import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { Tag } from "primereact/tag";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { ExportButtons } from "../../shared/ui/ExportButtons";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { exportReport, type ExportFormat } from "../accounting/export-report";
import { useAllWarehouses } from "./use-warehouses";
import { useStockLevels, type StockLevelEntry } from "./use-stock-levels";

const ALL_WAREHOUSES = "ALL";

export function StockLevelsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: warehouses } = useAllWarehouses();
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [belowReorderOnly, setBelowReorderOnly] = useState(false);

  const { data, isPending, isError, refetch } = useStockLevels({ warehouseId, belowReorderOnly });

  // Same filters as the table, so the file matches what is on screen.
  const handleExport = (format: ExportFormat) =>
    exportReport(
      "/v1/stock-levels/export",
      {
        lang: i18n.language,
        ...(warehouseId ? { warehouseId } : {}),
        ...(belowReorderOnly ? { belowReorderOnly: "true" } : {}),
      },
      "stock-levels",
      format,
    );

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("inventory.stockLevels.title")}</h1>
          <p className="erp-page__subtitle">{t("inventory.stockLevels.subtitle")}</p>
        </div>
        <div className="erp-page__header-actions">
          <ExportButtons onExport={handleExport} />
        </div>
      </div>

      <div className="coa-toolbar">
        <div className="coa-levels">
          <span className="coa-levels__label">{t("inventory.stockLevels.warehouse")}</span>
          <Dropdown
            value={warehouseId ?? ALL_WAREHOUSES}
            onChange={(e) => setWarehouseId(e.value === ALL_WAREHOUSES ? null : (e.value as string))}
            options={[
              { label: t("inventory.stockLevels.allWarehouses"), value: ALL_WAREHOUSES },
              ...(warehouses ?? []).map((w) => ({ label: localizedName(w, i18n.language), value: w.id })),
            ]}
          />
        </div>
        <label className="coa-levels" htmlFor="belowReorderOnly">
          <InputSwitch inputId="belowReorderOnly" checked={belowReorderOnly} onChange={(e) => setBelowReorderOnly(Boolean(e.value))} />
          <span className="coa-levels__label">{t("inventory.stockLevels.belowReorderOnly")}</span>
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
        <DataTable value={data ?? []} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
          <Column field="itemCode" header={t("inventory.items.code")} style={{ width: "8rem" }} body={(row: StockLevelEntry) => <span className="coa-code">{row.itemCode}</span>} />
          <Column header={t("inventory.items.name")} body={(row: StockLevelEntry) => <span className="coa-name">{localizedName({ name: row.itemName, nameAr: row.itemNameAr }, i18n.language)}</span>} />
          <Column header={t("inventory.stockLevels.warehouse")} body={(row: StockLevelEntry) => row.warehouseName} />
          <Column header={t("inventory.stockLevels.quantity")} align="right" body={(row: StockLevelEntry) => <span className="coa-amount">{row.quantity}</span>} />
          <Column header={t("inventory.stockLevels.averageUnitCost")} align="right" body={(row: StockLevelEntry) => <span className="coa-amount">{formatMoney(row.averageUnitCost, currency)}</span>} />
          <Column header={t("inventory.stockLevels.value")} align="right" body={(row: StockLevelEntry) => <span className="coa-amount">{formatMoney(row.value, currency)}</span>} />
          <Column
            header={t("inventory.stockLevels.reorderPoint")}
            style={{ width: "10rem" }}
            body={(row: StockLevelEntry) =>
              row.belowReorderPoint ? (
                <Tag value={t("inventory.stockLevels.belowReorder")} severity="danger" />
              ) : (
                <span className="coa-amount coa-amount--zero">{row.reorderPoint}</span>
              )
            }
          />
        </DataTable>
      )}
    </div>
  );
}
