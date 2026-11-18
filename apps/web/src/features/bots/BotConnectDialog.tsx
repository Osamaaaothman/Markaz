import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Checkbox } from "primereact/checkbox";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { RadioButton } from "primereact/radiobutton";
import { useFeedbackStore } from "../../shared/lib/feedback-store";
import {
  BOT_FEATURES,
  botErrorDetail,
  botErrorKey,
  useCreateBotConnection,
  useTestBotConnection,
  type BotIdentity,
  type BotTransport,
  type ProviderInfo,
} from "./use-bots";
import { CredentialFields, FeatureToggles, isDecimalInput } from "./bot-form-parts";

const GUIDE_STEPS: Readonly<Record<string, readonly string[]>> = {
  telegram: ["step1", "step2", "step3", "step4"],
  discord: ["step1", "step2", "step3", "step4", "step5"],
};

interface Props {
  readonly provider: ProviderInfo;
  readonly publicUrlConfigured: boolean;
  readonly onClose: () => void;
}

// The three-step connect flow (docs/BOTS-INTEGRATION-PLAN.md §8.2): how to get the credentials,
// enter + test them, then choose features and accept the data-sharing notice. Nothing is saved
// until the last step, and saving is impossible until the test has passed.
export function BotConnectDialog({ provider, publicUrlConfigured, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const notify = useFeedbackStore((s) => s.notify);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const defaultTransport: BotTransport = publicUrlConfigured || !provider.transports.includes("polling") ? "webhook" : "polling";
  const [transport, setTransport] = useState<BotTransport>(defaultTransport);
  const [identity, setIdentity] = useState<BotIdentity | null>(null);
  const [features, setFeatures] = useState<string[]>([...BOT_FEATURES]);
  const [ceiling, setCeiling] = useState("");
  const [accepted, setAccepted] = useState(false);
  const test = useTestBotConnection();
  const create = useCreateBotConnection();
  const providerName = t(`bots.providers.${provider.provider}.name`);

  const setValue = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setIdentity(null); // any change invalidates a previous test
  };

  const runTest = () =>
    test.mutate({ provider: provider.provider, credentials: values }, { onSuccess: (result) => setIdentity(result.identity) });

  const save = () =>
    create.mutate(
      {
        provider: provider.provider,
        transport,
        credentials: values,
        acceptDataSharing: accepted,
        enabledFeatures: features,
        approvalCeiling: ceiling.trim() === "" ? null : ceiling.trim(),
      },
      {
        onSuccess: () => {
          notify({ severity: "success", key: "bots.connect.created" });
          onClose();
        },
      },
    );

  const ceilingValid = ceiling.trim() === "" || isDecimalInput(ceiling.trim());
  const steps = [t("bots.connect.stepGuide"), t("bots.connect.stepCredentials"), t("bots.connect.stepConfirm")];
  const error = test.error ?? create.error;
  const errorDetail = botErrorDetail(error);

  const footer = (
    <div className="bots-copy" style={{ justifyContent: "flex-end" }}>
      <Button label={t("bots.actions.cancel")} text onClick={onClose} />
      {step > 0 ? <Button label={t("bots.actions.back")} outlined onClick={() => setStep(step - 1)} /> : null}
      {step < 2 ? (
        <Button label={t("bots.actions.next")} onClick={() => setStep(step + 1)} disabled={step === 1 && identity === null} />
      ) : (
        <Button label={t("bots.actions.save")} icon="pi pi-check" onClick={save} loading={create.isPending} disabled={!accepted || !ceilingValid || features.length === 0} />
      )}
    </div>
  );

  return (
    <Dialog header={t("bots.connect.title", { provider: providerName })} visible onHide={onClose} footer={footer} style={{ width: "min(680px, 96vw)" }} modal dismissableMask={false}>
      <ol className="bots-steps">
        {steps.map((label, index) => (
          <li key={label} aria-current={index === step ? "step" : undefined} className={index < step ? "is-done" : undefined}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <ol className="bots-guide">
          {(GUIDE_STEPS[provider.provider] ?? []).map((key) => (
            <li key={key}>{t(`bots.guide.${provider.provider}.${key}`)}</li>
          ))}
        </ol>
      ) : null}

      {step === 1 ? (
        <div className="bots-form">
          <CredentialFields fields={provider.credentialFields} values={values} onChange={setValue} stored={null} />
          {provider.transports.length > 1 ? (
            <fieldset className="bots-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600, marginBlockEnd: "var(--mk-space-2)" }}>{t("bots.connect.transport")}</legend>
              {provider.transports.map((option) => (
                <div key={option} className="bots-copy" style={{ alignItems: "flex-start" }}>
                  <RadioButton
                    inputId={`transport-${option}`}
                    name="transport"
                    value={option}
                    checked={transport === option}
                    onChange={() => setTransport(option)}
                    disabled={option === "webhook" && !publicUrlConfigured}
                  />
                  <label htmlFor={`transport-${option}`}>
                    <strong>{t(option === "webhook" ? "bots.connect.transportWebhook" : "bots.connect.transportPolling")}</strong>
                    <p className="bots-field__hint">{t(option === "webhook" ? "bots.connect.transportWebhookHelp" : "bots.connect.transportPollingHelp")}</p>
                  </label>
                </div>
              ))}
            </fieldset>
          ) : null}
          <div className="bots-copy">
            <Button label={t("bots.actions.test")} icon="pi pi-bolt" outlined onClick={runTest} loading={test.isPending} />
            {identity ? (
              <span className="bots-test-ok" role="status">
                <i className="pi pi-check-circle" aria-hidden="true" />
                {t("bots.connect.testOk", { name: `${identity.displayName} (${identity.username})` })}
              </span>
            ) : (
              <span className="bots-field__hint">{t("bots.connect.testFirst")}</span>
            )}
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="bots-form">
          <div>
            <h3 className="erp-card__title">{t("bots.connect.features")}</h3>
            <FeatureToggles value={features} onChange={setFeatures} />
          </div>
          {features.includes("approvals") ? (
            <div className="bots-field">
              <label htmlFor="bot-ceiling">{t("bots.connect.approvalCeiling")}</label>
              <InputText id="bot-ceiling" dir="ltr" inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value)} invalid={!ceilingValid} style={{ maxInlineSize: "220px" }} />
              <p className="bots-field__hint">{t("bots.connect.approvalCeilingHelp")}</p>
              {!ceilingValid ? <p className="bots-field__error">{t("bots.connect.approvalCeilingInvalid")}</p> : null}
            </div>
          ) : null}
          <div className="bots-notice" role="note">
            <i className="pi pi-shield" aria-hidden="true" style={{ fontSize: "1.3rem" }} />
            <div>
              <p className="bots-notice__title">{t("bots.connect.dataSharingTitle")}</p>
              <p style={{ margin: 0 }}>{t("bots.connect.dataSharingBody", { provider: providerName })}</p>
              <div className="bots-copy" style={{ marginBlockStart: "var(--mk-space-2)" }}>
                <Checkbox inputId="bot-accept" checked={accepted} onChange={(e) => setAccepted(e.checked === true)} />
                <label htmlFor="bot-accept">{t("bots.connect.dataSharingAccept")}</label>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="bots-field__error" role="alert" style={{ marginBlockStart: "var(--mk-space-3)" }}>
          {t(botErrorKey(error))}
          {errorDetail ? ` — ${t(`bots.testReasons.${errorDetail}`, { defaultValue: errorDetail })}` : null}
        </p>
      ) : null}
    </Dialog>
  );
}
