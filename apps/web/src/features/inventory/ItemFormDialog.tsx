import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { usePermissions } from "../../shared/auth/use-permissions";
import { PictureField } from "../attachments/PictureField";
import { useCreateItem, useUpdateItem, type ItemSummary } from "./use-items";

// UN/ECE Recommendation 20 codes required by ZATCA XML (inline — web bundle does not import @erp/core)
const UNIT_CODES = [
  { code: "PCE", nameEn: "Piece", nameAr: "قطعة" },
  { code: "SET", nameEn: "Set", nameAr: "مجموعة" },
  { code: "BOX", nameEn: "Box", nameAr: "صندوق" },
  { code: "CTN", nameEn: "Carton", nameAr: "كرتون" },
  { code: "PAL", nameEn: "Pallet", nameAr: "منصة" },
  { code: "BG",  nameEn: "Bag", nameAr: "كيس" },
  { code: "ROL", nameEn: "Roll", nameAr: "لفة" },
  { code: "KGM", nameEn: "Kilogram", nameAr: "كيلوغرام" },
  { code: "GRM", nameEn: "Gram", nameAr: "غرام" },
  { code: "TNE", nameEn: "Tonne", nameAr: "طن" },
  { code: "LTR", nameEn: "Litre", nameAr: "لتر" },
  { code: "MLT", nameEn: "Millilitre", nameAr: "ملليلتر" },
  { code: "MTQ", nameEn: "Cubic Metre", nameAr: "متر مكعب" },
  { code: "MTR", nameEn: "Metre", nameAr: "متر" },
  { code: "CMT", nameEn: "Centimetre", nameAr: "سنتيمتر" },
  { code: "MMT", nameEn: "Millimetre", nameAr: "ملليمتر" },
  { code: "KMT", nameEn: "Kilometre", nameAr: "كيلومتر" },
  { code: "MTK", nameEn: "Square Metre", nameAr: "متر مربع" },
  { code: "HUR", nameEn: "Hour", nameAr: "ساعة" },
  { code: "DAY", nameEn: "Day", nameAr: "يوم" },
  { code: "MON", nameEn: "Month", nameAr: "شهر" },
  { code: "ANN", nameEn: "Year", nameAr: "سنة" },
  { code: "DZN", nameEn: "Dozen", nameAr: "دزينة" },
  { code: "PR",  nameEn: "Pair", nameAr: "زوج" },
];

const itemSchema = z.object({
  code: z.string().trim().min(1, "required").max(20, "codeFormat"),
  name: z.string().trim().min(1, "required"),
  nameAr: z.string(),
  unit: z.string().trim().min(1, "required").max(20, "codeFormat"),
  unitCode: z.string().optional(),
  reorderPoint: z.string(),
  isActive: z.boolean(),
});
type ItemFormValues = z.infer<typeof itemSchema>;

const EMPTY: ItemFormValues = { code: "", name: "", nameAr: "", unit: "", unitCode: "", reorderPoint: "0", isActive: true };

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
  // A new item that has just been saved: the dialog stays open and becomes the edit form, so a picture can be added
  // straight away (a picture needs an item that exists to hang on).
  const [created, setCreated] = useState<ItemSummary | null>(null);
  const current = item ?? created;
  const createItem = useCreateItem();
  const updateItem = useUpdateItem(current?.id ?? "");
  const mutation = current ? updateItem : createItem;
  const canAddPicture = can("item:update") && can("attachment:create");

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ItemFormValues>({ resolver: zodResolver(itemSchema), defaultValues: EMPTY });

  useEffect(() => {
    if (!visible) return;
    setCreated(null);
    createItem.reset();
    updateItem.reset();
    reset(
      item
        ? { code: item.code, name: item.name, nameAr: item.nameAr ?? "", unit: item.unit, unitCode: item.unitCode ?? "", reorderPoint: item.reorderPoint, isActive: item.isActive }
        : EMPTY,
    );
  }, [visible, item?.id]);

  const onSubmit = handleSubmit((values) => {
    if (current) {
      updateItem.mutate(
        { name: values.name, nameAr: values.nameAr.trim() || null, unit: values.unit, unitCode: values.unitCode || null, reorderPoint: values.reorderPoint, isActive: values.isActive },
        { onSuccess: onHide },
      );
    } else {
      createItem.mutate(
        {
          code: values.code,
          name: values.name,
          ...(values.nameAr.trim() ? { nameAr: values.nameAr.trim() } : {}),
          unit: values.unit,
          ...(values.unitCode ? { unitCode: values.unitCode } : {}),
          reorderPoint: values.reorderPoint,
        },
        { onSuccess: (saved) => (canAddPicture ? setCreated(saved) : onHide()) },
      );
    }
  });

  const isConflict = createItem.isError && (createItem.error as { response?: { status?: number } })?.response?.status === 409;

  return (
    <Dialog header={current ? t("inventory.items.editTitle") : t("inventory.items.add")} visible={visible} onHide={onHide} className="erp-dialog" modal>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
        {!current ? (
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
            <InputText id="itemUnit" {...register("unit")} className={errors.unit ? "p-invalid" : ""} placeholder={t("inventory.items.unitPlaceholder")} />
            {errors.unit ? <small className="erp-field__error">{t("validation.required")}</small> : null}
          </div>
          <div className="erp-field">
            <label htmlFor="itemReorderPoint">{t("inventory.items.reorderPoint")}</label>
            <InputText id="itemReorderPoint" dir="ltr" {...register("reorderPoint")} />
          </div>
        </div>

        <div className="erp-field">
          <label htmlFor="itemUnitCode">{t("inventory.items.unitCode")}</label>
          <Controller
            control={control}
            name="unitCode"
            render={({ field }) => (
              <Dropdown
                inputId="itemUnitCode"
                value={field.value || null}
                onChange={(e) => field.onChange((e.value as string | null) ?? "")}
                options={UNIT_CODES}
                optionLabel="nameEn"
                optionValue="code"
                showClear
                placeholder={t("inventory.items.unitCodePlaceholder")}
              />
            )}
          />
        </div>

        {created ? <p className="mk-picture__hint">{t("inventory.items.savedAddPicture")}</p> : null}

        {current ? (
          <PictureField
            key={`${current.id}:${current.pictureId ?? "none"}`}
            ownerType="ITEM"
            ownerId={current.id}
            imagePath={`/v1/items/${current.id}/picture`}
            currentPictureId={current.pictureId}
            canChange={can("item:update")}
            label={t("inventory.items.picture")}
          />
        ) : canAddPicture ? (
          <p className="mk-picture__hint">{t("inventory.items.pictureAfterSave")}</p>
        ) : null}

        {current ? (
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
          <p className="erp-auth-card__error">{current ? t("inventory.items.updateError") : t("inventory.items.createError")}</p>
        ) : null}

        <div className="erp-form__actions">
          <Button label={t("actions.cancel")} type="button" text onClick={onHide} />
          <Button label={t("actions.save")} type="submit" loading={mutation.isPending} />
        </div>
      </form>
    </Dialog>
  );
}
