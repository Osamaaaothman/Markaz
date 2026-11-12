import { useState } from "react";
import { newId } from "@erp/shared";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Checkbox } from "primereact/checkbox";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { apiClient } from "../../shared/api/client";
import { localizedName } from "../../shared/lib/localized-name";
import { useAllWarehouses } from "./use-warehouses";
interface Suggestion {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemNameAr: string | null;
  unit: string;
  onHand: string;
  target: string;
  requested: string;
  incoming: string;
  suggested: string;
}
interface Result {
  data: Suggestion[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}
const units = (value: string): bigint => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, "0"));
};
export default function ReplenishmentDialog({
  warehouseId: initialWarehouse,
  onHide,
}: {
  warehouseId: string | null;
  onHide: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const warehouses = useAllWarehouses();
  const [warehouseId, setWarehouseId] = useState(initialWarehouse);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [key, setKey] = useState(newId);
  const query = useInfiniteQuery({
    queryKey: ["replenishment", warehouseId],
    enabled: !!warehouseId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<Result>("/v1/replenishment", {
          params: { warehouseId, ...(pageParam ? { cursor: pageParam } : {}) },
        })
      ).data,
    getNextPageParam: (page) => page.pageInfo.nextCursor ?? undefined,
  });
  const create = useMutation({
    meta: { successKey: "feedback.created" },
    mutationFn: async () =>
      (
        await apiClient.post<{ id: string; number: string }>(
          "/v1/replenishment/requests",
          {
            warehouseId,
            lines: Object.entries(selected).map(([itemId, quantity]) => ({ itemId, quantity })),
          },
          { headers: { "Idempotency-Key": key } },
        )
      ).data,
    onSuccess: async () => {
      setSelected({});
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["replenishment"] }),
        qc.invalidateQueries({ queryKey: ["purchaseRequests"] }),
        qc.invalidateQueries({ queryKey: ["purchasingCounts"] }),
      ]);
    },
  });
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];
  const selectedCount = Object.keys(selected).length;
  const invalidQuantity = (itemId: string, value: string): boolean =>
    !/^\d{1,15}(\.\d{1,4})?$/.test(value) ||
    !/[1-9]/.test(value) ||
    units(value) > units(rows.find((row) => row.itemId === itemId)?.suggested ?? "0");
  const invalid = Object.entries(selected).some(([itemId, value]) =>
    invalidQuantity(itemId, value),
  );
  return (
    <Dialog
      visible
      header={t("replenishment.title")}
      modal
      className="erp-dialog"
      onHide={() => {
        if (!create.isPending) onHide();
      }}
      closable={!create.isPending}
    >
      <p>{t("replenishment.hint")}</p>
      <p className="erp-field__hint">{t("replenishment.formula")}</p>
      <div className="erp-field">
        <label htmlFor="replenishWarehouse">{t("inventory.stockLevels.warehouse")}</label>
        <Dropdown
          inputId="replenishWarehouse"
          value={warehouseId}
          disabled={create.isPending}
          options={(warehouses.data ?? []).map((w) => ({
            value: w.id,
            label: localizedName(w, i18n.language),
          }))}
          onChange={(e) => {
            setWarehouseId(e.value as string);
            setSelected({});
            setKey(newId());
            create.reset();
          }}
        />
      </div>
      {query.isError || create.isError ? (
        <p role="alert" className="erp-page__error">
          {t("replenishment.error")}
        </p>
      ) : null}
      <Button
        type="button"
        text
        label={t("replenishment.refresh")}
        disabled={!warehouseId || create.isPending}
        onClick={() => {
          setSelected({});
          setKey(newId());
          create.reset();
          void query.refetch();
        }}
      />
      {warehouseId ? (
        <DataTable
          value={rows}
          cellMemo={false}
          loading={query.isFetching}
          emptyMessage={t("status.empty")}
          size="small"
          scrollable
        >
          <Column
            header={t("replenishment.select")}
            body={(row: Suggestion) => (
              <Checkbox
                aria-label={`${t("replenishment.select")} ${row.itemCode}`}
                checked={selected[row.itemId] !== undefined}
                disabled={
                  create.isPending ||
                  !/[1-9]/.test(row.suggested) ||
                  (selectedCount >= 100 && selected[row.itemId] === undefined)
                }
                onChange={(e) => {
                  setSelected((current) => {
                    const next = { ...current };
                    if (e.checked) next[row.itemId] = row.suggested;
                    else delete next[row.itemId];
                    return next;
                  });
                  setKey(newId());
                  create.reset();
                }}
              />
            )}
          />
          <Column
            header={t("inventory.movements.item")}
            body={(row: Suggestion) =>
              `${row.itemCode} — ${localizedName({ name: row.itemName, nameAr: row.itemNameAr }, i18n.language)}`
            }
          />
          {(["onHand", "target", "requested", "incoming", "suggested"] as const).map((field) => (
            <Column key={field} field={field} header={t(`replenishment.${field}`)} />
          ))}
          <Column field="unit" header={t("inventory.items.unit")} />
          <Column
            header={t("purchasing.quantity")}
            body={(row: Suggestion) =>
              selected[row.itemId] !== undefined ? (
                <div>
                  <InputText
                    aria-label={`${t("purchasing.quantity")} ${row.itemCode}`}
                    value={selected[row.itemId]}
                    invalid={invalidQuantity(row.itemId, selected[row.itemId]!)}
                    disabled={create.isPending}
                    inputMode="decimal"
                    onChange={(e) => {
                      const value = e.target.value;
                      setSelected((current) => ({ ...current, [row.itemId]: value }));
                      setKey(newId());
                      create.reset();
                    }}
                  />
                  {invalidQuantity(row.itemId, selected[row.itemId]!) ? (
                    <small role="alert">
                      {t("replenishment.quantityError", { max: row.suggested })}
                    </small>
                  ) : null}
                </div>
              ) : (
                "—"
              )
            }
          />
        </DataTable>
      ) : null}
      {query.hasNextPage ? (
        <Button
          type="button"
          text
          label={t("actions.loadMore")}
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        />
      ) : null}
      {create.data ? (
        <p role="status">
          {t("replenishment.created", { number: create.data.number })}{" "}
          <Button
            type="button"
            text
            label={t("replenishment.view")}
            onClick={() => {
              onHide();
              void navigate("/purchasing/requests");
            }}
          />
        </p>
      ) : null}
      <Button
        type="button"
        label={t("replenishment.create", { count: selectedCount })}
        disabled={create.isPending || !warehouseId || !selectedCount || invalid || query.isFetching}
        loading={create.isPending}
        onClick={() => create.mutate()}
      />
    </Dialog>
  );
}
