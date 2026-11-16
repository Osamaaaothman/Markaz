import { useTranslation } from "react-i18next";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Password } from "primereact/password";
import { BOT_FEATURES, type CredentialField } from "./use-bots";

// Pieces shared by the connect dialog and the manage panel.

export function isDecimalInput(value: string): boolean {
  return /^\d{1,15}(\.\d{1,4})?$/.test(value);
}

interface CredentialFieldsProps {
  readonly fields: readonly CredentialField[];
  readonly values: Readonly<Record<string, string>>;
  readonly onChange: (key: string, value: string) => void;
  // Manage mode: what is stored now (secrets masked). Null while connecting for the first time.
  readonly stored: {
    readonly secrets: Readonly<Record<string, { readonly set: boolean; readonly last4: string | null }>>;
    readonly publicConfig: Readonly<Record<string, string>>;
  } | null;
}

// The credential form is built from what the adapter declares (docs/BOTS-INTEGRATION-PLAN.md §8.2),
// so a new platform needs no new form code. Secrets are never pre-filled.
export function CredentialFields({ fields, values, onChange, stored }: CredentialFieldsProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {fields.map((field) => {
        const id = `bot-cred-${field.key}`;
        const value = values[field.key] ?? "";
        const pattern = field.pattern ? new RegExp(field.pattern) : null;
        const invalid = value.trim() !== "" && pattern !== null && !pattern.test(value.trim());
        const secretState = stored?.secrets[field.key];
        const placeholder = field.kind === "secret" && secretState?.set
          ? secretState.last4 ? t("bots.credentials.stored", { last4: secretState.last4 }) : t("bots.credentials.storedShort")
          : field.kind !== "secret" ? stored?.publicConfig[field.key] : undefined;
        return (
          <div key={field.key} className="bots-field">
            <label htmlFor={id}>
              {t(field.labelKey)}
              {field.required ? <span aria-hidden="true"> *</span> : null}
            </label>
            {field.kind === "secret" ? (
              <Password
                inputId={id}
                value={value}
                onChange={(e) => onChange(field.key, e.target.value)}
                feedback={false}
                toggleMask
                autoComplete="off"
                inputStyle={{ direction: "ltr", inlineSize: "100%" }}
                style={{ inlineSize: "100%" }}
                invalid={invalid}
                {...(placeholder ? { placeholder } : {})}
              />
            ) : (
              <InputText
                id={id}
                dir="ltr"
                value={value}
                onChange={(e) => onChange(field.key, e.target.value)}
                autoComplete="off"
                invalid={invalid}
                {...(placeholder ? { placeholder } : {})}
              />
            )}
            <p className="bots-field__hint">{t(field.helpKey)}</p>
            {invalid ? <p className="bots-field__error">{t("bots.errors.CREDENTIALS_INVALID")}</p> : null}
          </div>
        );
      })}
    </>
  );
}

interface FeatureTogglesProps {
  readonly value: readonly string[];
  readonly onChange: (next: string[]) => void;
  readonly disabled?: boolean;
}

export function FeatureToggles({ value, onChange, disabled = false }: FeatureTogglesProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="bots-features">
      {BOT_FEATURES.map((feature) => {
        const id = `bot-feature-${feature}`;
        const checked = value.includes(feature);
        return (
          <div key={feature} className="bots-feature">
            <InputSwitch
              inputId={id}
              checked={checked}
              disabled={disabled}
              onChange={(e) => onChange(e.value ? [...value, feature] : value.filter((f) => f !== feature))}
            />
            <label htmlFor={id}>
              <p><strong>{t(`bots.features.${feature}.label`)}</strong></p>
              <p className="bots-feature__hint">{t(`bots.features.${feature}.hint`)}</p>
            </label>
          </div>
        );
      })}
    </div>
  );
}
