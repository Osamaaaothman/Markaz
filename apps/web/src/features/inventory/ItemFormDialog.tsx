import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { usePermissions } from "../../shared/auth/use-permissions";
import { PictureField } from "../attachments/PictureField";
import { useCreateItem, useUpdateItem, type ItemSummary } from "./use-items";

const itemSchema = z.object({
  code: z.string().trim().min(1, "required").max(20, "codeFormat"),
  name: z.string().trim().min(1, "required"),
  nameAr: z.string(),
  unit: z.string().trim().min(1, "required").max(20, "codeFormat"),
  reorderPoint: z.string(),
  isActive: z.boolean(),
});
type ItemFormValues = z.infer<typeof itemSchema>;

const EMPTY: ItemFormValues = { code: "", name: "", nameAr: "", unit: "", reorderPoint: "0", isActive: true };

export function ItemFormDialog({
  item,
  visible,
  onHide,
}: {
  item: ItemSummary | null;
  visible: boolean;
  onHide: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const createItem = useCreateItem();
  const updateItem = useUpdateItem(item?.id ?? "");
  const mutation = item ? updateItem : createItem;

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ItemFormValues>({ resolver: zodResolver(itemSchema), defaultValues: EMPTY });

  useEffect(() => {
    if (!visible) return;
    createItem.reset();
    updateItem.reset();
    reset(
      item
        ? { code: item.code, name: item.name, nameAr: item.nameAr ?? "", unit: item.unit, reorderPoint: item.reorderPoint, isActive: item.isActive }
        : EMPTY,
    );
  }, [visible, item?.id]);

  const onSubmit = handleSubmit((values) => {
    if (item) {
      updateItem.mutate(
        { name: values.name, nameAr: values.nameAr.trim() || null, unit: values.unit, reorderPoint: values.reorderPoint, isActive: values.isActive },
        { onSuccess: onHide },
      );
    } else {
      createItem.mutate(
        {
          code: values.code,
          name: values.name,
          ...(values.nameAr.trim() ? { nameAr: values.nameAr.trim() } : {}),
          unit: values.unit,
          reorderPoint: values.reorderPoint,
        },
        { onSuccess: onHide },
      );
    }
  });

  const isConflict = createItem.isError && (createItem.error as { response?: { status?: number } })?.response?.status === 409;

  return (
    <Dialog header={item ? t("inventory.items.editTitle") : t("inventory.items.add")} visible={visible} onHide={onHide} className="erp-dialog" modal>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
        {!item ? (
          <div className="erp-field">
            <label htmlFor="itemCode">{t("inventory.items.code")}</label>
            <InputText id="itemCode" dir="ltr" {...register("code")} className={errors.code ? "p-invalid" : ""} />
            {errors.code ? <small className="erp-field__error">{t(`validation.${errors.code.message}`)}</small> : null}
          </div>
        ) : null}

        <div className="erp-field">
          <label htmlFor="itemName">{t("inventory.items.name")}</label>
          <InputText id="itemName" {...register("name")} className={errors.name ? "p-invalid" : ""} />
          {errors.name ? <small className="erp-field__error">{t("validation.required")}</small> : null}
        </div>

        <div className="erp-field">
          <label htmlFor="itemNameAr">{t("inventory.items.nameAr")}</label>
          <InputText id="itemNameAr" dir="rtl" {...register("nameAr")} />
        </div>

        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="itemUnit">{t("inventory.items.unit")}</label>
            <InputText id="itemUnit" dir="ltr" {...register("unit")} className={errors.unit ? "p-invalid" : ""} placeholder={t("inventory.items.unitPlaceholder")} />
            {errors.unit ? <small className="erp-field__error">{t("validation.required")}</small> : null}
          </div>
          <div className="erp-field">
            <label htmlFor="itemReorderPoint">{t("inventory.items.reorderPoint")}</label>
            <InputText id="itemReorderPoint" dir="ltr" {...register("reorderPoint")} />
          </div>
        </div>

        {item ? (
          <PictureField
            key={`${item.id}:${item.pictureId ?? "none"}`}
            ownerType="ITEM"
            ownerId={item.id}
            imagePath={`/v1/items/${item.id}/picture`}
            currentPictureId={item.pictureId}
            canChange={can("item:update")}
            label={t("inventory.items.picture")}
          />
        ) : (
          <p className="mk-picture__hint">{t("inventory.items.pictureAfterSave")}</p>
        )}

        {item ? (
          <div className="erp-field" style={{ flexDirection: "row", alignItems: "center", gap: "0.75rem" }}>
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => <InputSwitch inputId="itemActive" checked={field.value} onChange={(e) => field.onChange(e.value)} />}
            />
            <label htmlFor="itemActive" style={{ marginBlockEnd: 0 }}>
              {t("inventory.items.active")}
            </label>
          </div>
        ) : null}

        {isConflict ? (
          <p className="erp-auth-card__error">{t("inventory.items.duplicateCode")}</p>
        ) : mutation.isError ? (
          <p className="erp-auth-card__error">{item ? t("inventory.items.updateError") : t("inventory.items.createError")}</p>
        ) : null}

        <div className="erp-form__actions">
          <Button label={t("actions.cancel")} type="button" text onClick={onHide} />
          <Button label={t("actions.save")} type="submit" loading={mutation.isPending} />
        </div>
      </form>
    </Dialog>
  );
}
