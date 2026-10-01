import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { useCreateWarehouse, useUpdateWarehouse, type WarehouseSummary } from "./use-warehouses";

// Messages are translation-key suffixes under `validation.` (see LoginPage's schema).
const warehouseSchema = z.object({
  code: z.string().trim().min(1, "required").max(20, "codeFormat"),
  name: z.string().trim().min(1, "required"),
  nameAr: z.string(),
  isActive: z.boolean(),
});
type WarehouseFormValues = z.infer<typeof warehouseSchema>;

const EMPTY: WarehouseFormValues = { code: "", name: "", nameAr: "", isActive: true };

// One dialog for both adding (warehouse = null) and editing a warehouse.
export function WarehouseFormDialog({
  warehouse,
  visible,
  onHide,
}: {
  warehouse: WarehouseSummary | null;
  visible: boolean;
  onHide: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const createWarehouse = useCreateWarehouse();
  const updateWarehouse = useUpdateWarehouse(warehouse?.id ?? "");
  const mutation = warehouse ? updateWarehouse : createWarehouse;

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<WarehouseFormValues>({ resolver: zodResolver(warehouseSchema), defaultValues: EMPTY });

  useEffect(() => {
    if (!visible) return;
    createWarehouse.reset();
    updateWarehouse.reset();
    reset(
      warehouse
        ? { code: warehouse.code, name: warehouse.name, nameAr: warehouse.nameAr ?? "", isActive: warehouse.isActive }
        : EMPTY,
    );
    // Reset only when the dialog opens (or for another warehouse), not on every re-render.
  }, [visible, warehouse?.id]);

  const onSubmit = handleSubmit((values) => {
    if (warehouse) {
      updateWarehouse.mutate(
        { name: values.name, nameAr: values.nameAr.trim() || null, isActive: values.isActive },
        { onSuccess: onHide },
      );
    } else {
      createWarehouse.mutate(
        { code: values.code, name: values.name, ...(values.nameAr.trim() ? { nameAr: values.nameAr.trim() } : {}) },
        { onSuccess: onHide },
      );
    }
  });

  const isConflict =
    createWarehouse.isError && (createWarehouse.error as { response?: { status?: number } })?.response?.status === 409;

  return (
    <Dialog
      header={warehouse ? t("inventory.warehouses.editTitle") : t("inventory.warehouses.add")}
      visible={visible}
      onHide={onHide}
      className="erp-dialog"
      modal
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
        {!warehouse ? (
          <div className="erp-field">
            <label htmlFor="warehouseCode">{t("inventory.warehouses.code")}</label>
            <InputText id="warehouseCode" dir="ltr" {...register("code")} className={errors.code ? "p-invalid" : ""} />
            {errors.code ? <small className="erp-field__error">{t(`validation.${errors.code.message}`)}</small> : null}
          </div>
        ) : null}

        <div className="erp-field">
          <label htmlFor="warehouseName">{t("inventory.warehouses.name")}</label>
          <InputText id="warehouseName" {...register("name")} className={errors.name ? "p-invalid" : ""} />
          {errors.name ? <small className="erp-field__error">{t("validation.required")}</small> : null}
        </div>

        <div className="erp-field">
          <label htmlFor="warehouseNameAr">{t("inventory.warehouses.nameAr")}</label>
          <InputText id="warehouseNameAr" dir="rtl" {...register("nameAr")} />
        </div>

        {warehouse ? (
          <div className="erp-field" style={{ flexDirection: "row", alignItems: "center", gap: "0.75rem" }}>
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <InputSwitch inputId="warehouseActive" checked={field.value} onChange={(e) => field.onChange(e.value)} />
              )}
            />
            <label htmlFor="warehouseActive" style={{ marginBlockEnd: 0 }}>
              {t("inventory.warehouses.active")}
            </label>
          </div>
        ) : null}

        {isConflict ? (
          <p className="erp-auth-card__error">{t("inventory.warehouses.duplicateCode")}</p>
        ) : mutation.isError ? (
          <p className="erp-auth-card__error">{warehouse ? t("inventory.warehouses.updateError") : t("inventory.warehouses.createError")}</p>
        ) : null}

        <div className="erp-form__actions">
          <Button label={t("actions.cancel")} type="button" text onClick={onHide} />
          <Button label={t("actions.save")} type="submit" loading={mutation.isPending} />
        </div>
      </form>
    </Dialog>
  );
}
