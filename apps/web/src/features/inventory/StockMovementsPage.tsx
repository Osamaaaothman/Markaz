import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dropdown } from "primereact/dropdown";
import { Tag } from "primereact/tag";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { downloadBlob } from "../../shared/lib/download-file";
import { formatCalendarDate, toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useAllItems } from "./use-items";
import { useAllWarehouses } from "./use-warehouses";

type MovementType = "RECEIPT" | "ISSUE" | "COUNT_ADJUSTMENT";

interface MovementEntry {
  readonly id: string;
  readonly date: string;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly itemNameAr: string | null;
  readonly warehouseName: string;
  readonly movementType: MovementType;
  readonly quantity: string;
  readonly unitCost: string;
  readonly value: string;
  readonly sourceDocumentType: string;
  readonly entryNumber: string;
}

interface Page {
  readonly data: readonly MovementEntry[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

const ALL = "ALL";
const TYPES: readonly MovementType[] = ["RECEIPT", "ISSUE", "COUNT_ADJUSTMENT"];

// The stock card: every movement of every item. Read-only — movements are written only by the posting
// documents (receipt, issue, count, sales invoice), so there is nothing to edit here.
export function StockMovementsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: items } = useAllItems();
  const { data: warehouses } = useAllWarehouses();

  const [itemId, setItemId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [type, setType] = useState<MovementType | null>(null);
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);

  const filters: Record<string, string> = {
    ...(itemId ? { itemId } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...(type ? { movementType: type } : {}),
    ...(from ? { from: toDateOnlyIsoString(from) } : {}),
    ...(to ? { to: toDateOnlyIsoString(to) } : {}),
  };

  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["stockMovements", filters],
    queryFn: async ({ pageParam }) =>
      (await apiClient.get<Page>("/v1/stock-movements", { params: { ...filters, limit: "50", ...(pageParam ? { cursor: pageParam } : {}) } })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("stock:read"),
  });
  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  const exportCsv = async (): Promise<void> => {
    const response = await apiClient.get<Blob>("/v1/stock-movements/export", { params: filters, responseType: "blob" });
    downloadBlob(response.data, "stock-movements.csv");
  };

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("inventory.movements.title")}</h1>
          <p className="erp-page__subtitle">{t("inventory.movements.subtitle")}</p>
        </div>
        <div className="erp-page__header-actions">
          <Button label={t("actions.exportCsv")} icon="pi pi-file" outlined onClick={() => void exportCsv()} />
        </div>
      </div>

      <div className="erp-form__row">
        <div className="erp-field">
          <label htmlFor="mvItem">{t("inventory.movements.item")}</label>
          <Dropdown
            inputId="mvItem"
            value={itemId ?? ALL}
            onChange={(e) => setItemId(e.value === ALL ? null : (e.value as string))}
            options={[{ label: t("inventory.movements.allItems"), value: ALL }, ...(items ?? []).map((i) => ({ label: `${i.code} — ${localizedName(i, i18n.language)}`, value: i.id }))]}
            filter
          />
        </div>
        <div className="erp-field">
          <label htmlFor="mvWarehouse">{t("inventory.stockLevels.warehouse")}</label>
          <Dropdown
            inputId="mvWarehouse"
            value={warehouseId ?? ALL}
            onChange={(e) => setWarehouseId(e.value === ALL ? null : (e.value as string))}
            options={[{ label: t("inventory.stockLevels.allWarehouses"), value: ALL }, ...(warehouses ?? []).map((w) => ({ label: localizedName(w, i18n.language), value: w.id }))]}
          />
        </div>
        <div className="erp-field">
          <label htmlFor="mvType">{t("inventory.movements.type")}</label>
          <Dropdown
            inputId="mvType"
            value={type ?? ALL}
            onChange={(e) => setType(e.value === ALL ? null : (e.value as MovementType))}
            options={[{ label: t("inventory.movements.allTypes"), value: ALL }, ...TYPES.map((x) => ({ label: t(`inventory.movements.types.${x}`), value: x }))]}
          />
        </div>
        <div className="erp-field">
          <label htmlFor="mvFrom">{t("accounting.incomeStatement.from")}</label>
          <Calendar inputId="mvFrom" value={from} onChange={(e) => setFrom(e.value ?? null)} dateFormat="yy-mm-dd" showButtonBar />
        </div>
        <div className="erp-field">
          <label htmlFor="mvTo">{t("accounting.incomeStatement.to")}</label>
          <Calendar inputId="mvTo" value={to} onChange={(e) => setTo(e.value ?? null)} dateFormat="yy-mm-dd" showButtonBar />
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
          <DataTable value={rows} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
            <Column header={t("inventory.movements.date")} style={{ width: "9rem" }} body={(r: MovementEntry) => formatCalendarDate(r.date, i18n.language)} />
            <Column header={t("inventory.items.code")} style={{ width: "9rem" }} body={(r: MovementEntry) => <span className="coa-code">{r.itemCode}</span>} />
            <Column header={t("inventory.items.name")} body={(r: MovementEntry) => localizedName({ name: r.itemName, nameAr: r.itemNameAr }, i18n.language)} />
            <Column header={t("inventory.stockLevels.warehouse")} body={(r: MovementEntry) => r.warehouseName} />
            <Column
              header={t("inventory.movements.type")}
              style={{ width: "10rem" }}
              body={(r: MovementEntry) => <Tag value={t(`inventory.movements.types.${r.movementType}`)} severity={Number(r.quantity) >= 0 ? "success" : "warning"} />}
            />
            <Column header={t("inventory.movements.source")} body={(r: MovementEntry) => t(`inventory.movements.sources.${r.sourceDocumentType}`, r.sourceDocumentType)} />
            <Column header={t("inventory.movements.entry")} style={{ width: "9rem" }} body={(r: MovementEntry) => <span className="coa-code">{r.entryNumber}</span>} />
            <Column header={t("purchasing.quantity")} align="right" body={(r: MovementEntry) => <strong>{r.quantity}</strong>} />
            <Column header={t("inventory.movements.unitCost")} align="right" body={(r: MovementEntry) => formatMoney(r.unitCost, currency)} />
            <Column header={t("inventory.stockLevels.value")} align="right" body={(r: MovementEntry) => formatMoney(r.value, currency)} />
          </DataTable>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
