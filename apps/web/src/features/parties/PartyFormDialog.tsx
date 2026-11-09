import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import type { CreatedInfo } from "../../shared/ui/CreatedDialog";
import { PARTY_KINDS, useCreateParty, useUpdateParty, type PartySummary, type CreatePartyResult } from "./use-parties";

// Messages are translation-key suffixes under `validation.` (see LoginPage's schema).
const partySchema = z.object({
  name: z.string().trim().min(1, "required"),
  nameAr: z.string(),
  kind: z.enum(PARTY_KINDS),
  phone: z.string(),
  email: z.union([z.literal(""), z.string().email("invalidEmail")]),
  vatNumber: z.string(),
  commercialRegistration: z.string(),
  streetName: z.string(),
  additionalStreetName: z.string(),
  buildingNumber: z.string(),
  additionalNumber: z.string(),
  district: z.string(),
  city: z.string(),
  postalCode: z.string(),
  isActive: z.boolean(),
});
type PartyFormValues = z.infer<typeof partySchema>;

const EMPTY: PartyFormValues = {
  name: "",
  nameAr: "",
  kind: "PERSON",
  phone: "",
  email: "",
  vatNumber: "",
  commercialRegistration: "",
  streetName: "",
  additionalStreetName: "",
  buildingNumber: "",
  additionalNumber: "",
  district: "",
  city: "",
  postalCode: "",
  isActive: true,
};

// One dialog for both adding (party = null) and editing a party.
export function PartyFormDialog({
  party,
  visible,
  onHide,
  onCreated,
}: {
  party: PartySummary | null;
  visible: boolean;
  onHide: () => void;
  onCreated?: (info: CreatedInfo) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const createParty = useCreateParty();
  const updateParty = useUpdateParty(party?.id ?? "");
  const mutation = party ? updateParty : createParty;

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PartyFormValues>({ resolver: zodResolver(partySchema), defaultValues: EMPTY });

  // Load the party being edited (or a blank form) each time the dialog opens.
  useEffect(() => {
    if (!visible) return;
    createParty.reset();
    updateParty.reset();
    reset(
      party
        ? {
            name: party.name,
            nameAr: party.nameAr ?? "",
            kind: party.kind as PartyFormValues["kind"],
            phone: party.phone ?? "",
            email: party.email ?? "",
            vatNumber: party.vatNumber ?? "",
            commercialRegistration: party.commercialRegistration ?? "",
            streetName: party.streetName ?? "",
            additionalStreetName: party.additionalStreetName ?? "",
            buildingNumber: party.buildingNumber ?? "",
            additionalNumber: party.additionalNumber ?? "",
            district: party.district ?? "",
            city: party.city ?? "",
            postalCode: party.postalCode ?? "",
            isActive: party.isActive,
          }
        : EMPTY,
    );
    // Reset only when the dialog opens (or for another party), not on every re-render.
  }, [visible, party?.id]);

  const onSubmit = handleSubmit((values) => {
    if (party) {
      updateParty.mutate(
        {
          name: values.name,
          nameAr: values.nameAr.trim() || null,
          kind: values.kind,
          phone: values.phone.trim() || null,
          email: values.email.trim() || null,
          vatNumber: values.vatNumber.trim() || null,
          commercialRegistration: values.commercialRegistration.trim() || null,
          streetName: values.streetName.trim() || null,
          additionalStreetName: values.additionalStreetName.trim() || null,
          buildingNumber: values.buildingNumber.trim() || null,
          additionalNumber: values.additionalNumber.trim() || null,
          district: values.district.trim() || null,
          city: values.city.trim() || null,
          postalCode: values.postalCode.trim() || null,
          isActive: values.isActive,
        },
        { onSuccess: onHide },
      );
    } else {
      createParty.mutate(
        {
          name: values.name,
          kind: values.kind,
          ...(values.nameAr.trim() ? { nameAr: values.nameAr.trim() } : {}),
          ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
          ...(values.email.trim() ? { email: values.email.trim() } : {}),
          ...(values.vatNumber.trim() ? { vatNumber: values.vatNumber.trim() } : {}),
          ...(values.commercialRegistration.trim() ? { commercialRegistration: values.commercialRegistration.trim() } : {}),
          ...(values.streetName.trim() ? { streetName: values.streetName.trim() } : {}),
          ...(values.additionalStreetName.trim() ? { additionalStreetName: values.additionalStreetName.trim() } : {}),
          ...(values.buildingNumber.trim() ? { buildingNumber: values.buildingNumber.trim() } : {}),
          ...(values.additionalNumber.trim() ? { additionalNumber: values.additionalNumber.trim() } : {}),
          ...(values.district.trim() ? { district: values.district.trim() } : {}),
          ...(values.city.trim() ? { city: values.city.trim() } : {}),
          ...(values.postalCode.trim() ? { postalCode: values.postalCode.trim() } : {}),
        },
        {
          onSuccess: (saved: CreatePartyResult) => {
            onCreated?.({
              title: t("parties.add"),
              headline: saved.ref,
              rows: [
                { label: t("created.name"), value: saved.name },
                { label: t("created.nameAr"), value: saved.nameAr ?? "" },
                { label: t("created.type"), value: t(`parties.kinds.${saved.kind}`) },
                { label: t("created.phone"), value: saved.phone ?? "", ltr: true },
                { label: t("created.email"), value: saved.email ?? "", ltr: true },
                { label: t("parties.vatNumber"), value: saved.vatNumber ?? "", ltr: true },
                { label: t("parties.commercialRegistration"), value: saved.commercialRegistration ?? "", ltr: true },
                ...(saved.accountCode ? [{ label: t("parties.ledgerAccount"), value: saved.accountCode, ltr: true }] : []),
              ],
            });
            onHide();
          },
        },
      );
    }
  });

  return (
    <Dialog
      header={party ? t("parties.editTitle") : t("parties.add")}
      visible={visible}
      onHide={onHide}
      className="erp-dialog erp-dialog--wide"
      modal
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
        <div className="erp-field">
          <label htmlFor="partyName">{t("parties.name")}</label>
          <InputText id="partyName" {...register("name")} className={errors.name ? "p-invalid" : ""} />
          {errors.name ? <small className="erp-field__error">{t("validation.required")}</small> : null}
        </div>

        <div className="erp-field">
          <label htmlFor="partyNameAr">{t("parties.nameAr")}</label>
          <InputText id="partyNameAr" dir="rtl" {...register("nameAr")} />
        </div>

        <div className="erp-field">
          <label htmlFor="partyKind">{t("parties.kind")}</label>
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <Dropdown
                inputId="partyKind"
                value={field.value}
                onChange={(e) => field.onChange(e.value)}
                options={PARTY_KINDS.map((kind) => ({ label: t(`parties.kinds.${kind}`), value: kind }))}
              />
            )}
          />
        </div>

        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="partyPhone">{t("parties.phone")}</label>
            <InputText id="partyPhone" dir="ltr" {...register("phone")} />
          </div>
          <div className="erp-field">
            <label htmlFor="partyEmail">{t("parties.email")}</label>
            <InputText id="partyEmail" type="email" dir="ltr" {...register("email")} className={errors.email ? "p-invalid" : ""} />
            {errors.email ? <small className="erp-field__error">{t("validation.invalidEmail")}</small> : null}
          </div>
        </div>

        <h3 className="erp-form__section-title">{t("parties.taxAndAddress")}</h3>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="partyVatNumber">{t("parties.vatNumber")}</label>
            <InputText id="partyVatNumber" dir="ltr" {...register("vatNumber")} />
          </div>
          <div className="erp-field">
            <label htmlFor="partyCr">{t("parties.commercialRegistration")}</label>
            <InputText id="partyCr" dir="ltr" {...register("commercialRegistration")} />
          </div>
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="partyStreet">{t("parties.streetName")}</label>
            <InputText id="partyStreet" {...register("streetName")} />
          </div>
          <div className="erp-field">
            <label htmlFor="partyStreet2">{t("parties.additionalStreetName")}</label>
            <InputText id="partyStreet2" {...register("additionalStreetName")} />
          </div>
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="partyBuildingNumber">{t("parties.buildingNumber")}</label>
            <InputText id="partyBuildingNumber" dir="ltr" {...register("buildingNumber")} />
          </div>
          <div className="erp-field">
            <label htmlFor="partyAdditionalNumber">{t("parties.additionalNumber")}</label>
            <InputText id="partyAdditionalNumber" dir="ltr" {...register("additionalNumber")} />
          </div>
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="partyDistrict">{t("parties.district")}</label>
            <InputText id="partyDistrict" {...register("district")} />
          </div>
          <div className="erp-field">
            <label htmlFor="partyCity">{t("parties.city")}</label>
            <InputText id="partyCity" {...register("city")} />
          </div>
          <div className="erp-field">
            <label htmlFor="partyPostalCode">{t("parties.postalCode")}</label>
            <InputText id="partyPostalCode" dir="ltr" {...register("postalCode")} />
          </div>
        </div>

        {party ? (
          <div className="erp-field" style={{ flexDirection: "row", alignItems: "center", gap: "0.75rem" }}>
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <InputSwitch inputId="partyActive" checked={field.value} onChange={(e) => field.onChange(e.value)} />
              )}
            />
            <label htmlFor="partyActive" style={{ marginBlockEnd: 0 }}>
              {t("parties.active")}
            </label>
          </div>
        ) : null}

        {mutation.isError ? (
          <p className="erp-auth-card__error">{party ? t("parties.updateError") : t("parties.createError")}</p>
        ) : null}

        <div className="erp-form__actions">
          <Button label={t("actions.cancel")} type="button" text onClick={onHide} />
          <Button label={t("actions.save")} type="submit" loading={mutation.isPending} />
        </div>
      </form>
    </Dialog>
  );
}
