import { isAxiosError } from "axios";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { InputNumber } from "primereact/inputnumber";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Password } from "primereact/password";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePermissions } from "../../shared/auth/use-permissions";
import { groupThousands } from "../../shared/lib/money";
import { useFeedbackStore } from "../../shared/lib/feedback-store";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useAiSettings, useSaveAiSettings, useTestAiSettings, type AiSettingsInput, type ProviderKind } from "./ai-api";
import { AssistantOrb } from "./components/AssistantOrb";
import "./ai.css";

const PROVIDERS: ProviderKind[] = ["google", "openai-compatible", "anthropic", "openai", "ollama"];
// Suggested starting models; any model id the provider offers can be typed instead.
const MODEL_HINTS: Record<ProviderKind, string> = {
  google: "gemini-3.1-flash-lite",
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-5-mini",
  "openai-compatible": "llama-3.3-70b-versatile",
  ollama: "qwen3:4b",
};

function codeOf(error: unknown): string {
  return isAxiosError(error) ? ((error.response?.data as { code?: string; error?: { code?: string } } | undefined)?.code ?? "PROVIDER_ERROR") : "PROVIDER_ERROR";
}

// Settings → AI assistant. The key is write-only: the page only ever learns whether one is stored.
export function AiSettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const settings = useAiSettings(can("ai_settings:manage"));
  const save = useSaveAiSettings();
  const test = useTestAiSettings();
  const notify = useFeedbackStore((s) => s.notify);
  const [form, setForm] = useState<AiSettingsInput | null>(null);
  const [preset, setPreset] = useState<string | null>(null);

  useEffect(() => {
    const d = settings.data;
    if (!d || form) return;
    setForm({ provider: d.provider ?? "google", model: d.model ?? MODEL_HINTS.google, baseUrl: d.baseUrl, enabled: d.source === "none" ? true : d.enabled, autoModeEnabled: d.autoModeEnabled, monthlyTokenLimit: d.monthlyTokenLimit, version: d.version });
  }, [settings.data, form]);

  if (settings.isPending || !form) return <PageSkeleton />;
  if (settings.isError) return <div className="erp-page"><p className="erp-page__error">{t("status.error")}</p></div>;
  const d = settings.data;
  const set = (patch: Partial<AiSettingsInput>): void => setForm({ ...form, ...patch });
  const needsUrl = form.provider === "openai-compatible" || form.provider === "ollama";
  const presetOptions = Object.entries(d.presets).map(([key, url]) => ({ label: t(`ai.settings.preset.${key}`, { defaultValue: key }), value: key, url }));
  // An empty key box means "keep the stored key": the field is left out of the request.
  const withoutKey = (): AiSettingsInput => { const copy = { ...form }; delete copy.apiKey; return copy; };
  const payload = (): AiSettingsInput => (form.apiKey ? form : withoutKey());

  return (
    <div className="erp-page ai-settings">
      <div className="erp-page__header">
        <div className="ai-settings__heading">
          <AssistantOrb size={40} />
          <div>
            <h1 className="erp-page__title">{t("ai.settings.title")}</h1>
            <p className="erp-page__subtitle">{t("ai.settings.subtitle")}</p>
          </div>
        </div>
      </div>

      {d.source === "environment" ? <div className="ai-notice"><i className="pi pi-server" aria-hidden="true" /> {t("ai.settings.fromEnv")}</div> : null}
      <div className="ai-notice ai-notice--warn"><i className="pi pi-shield" aria-hidden="true" /> {t("ai.settings.privacy")}</div>

      <div className="ai-settings__grid">
        <section className="erp-card ai-settings__card">
          <h2 className="erp-card__title">{t("ai.settings.provider")}</h2>
          <div className="ai-provider-grid" role="radiogroup">
            {PROVIDERS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={form.provider === p} className={`ai-provider${form.provider === p ? " is-active" : ""}`} onClick={() => set({ provider: p, model: p === form.provider ? form.model : MODEL_HINTS[p] })}>
                <strong>{t(`ai.settings.providers.${p}`)}</strong>
                <span>{t(`ai.settings.providerHints.${p}`)}</span>
              </button>
            ))}
          </div>

          {form.provider === "openai-compatible" ? (
            <label className="ai-field">
              <span>{t("ai.settings.preset.label")}</span>
              <Dropdown value={preset} options={presetOptions} optionLabel="label" optionValue="value" placeholder={t("ai.settings.preset.placeholder")} onChange={(e) => { const value = e.value as string; setPreset(value); set({ baseUrl: d.presets[value] ?? form.baseUrl ?? null }); }} />
            </label>
          ) : null}
          {needsUrl ? (
            <label className="ai-field">
              <span>{t("ai.settings.baseUrl")}</span>
              <InputText dir="ltr" value={form.baseUrl ?? ""} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://…/v1" />
            </label>
          ) : null}
          <label className="ai-field">
            <span>{t("ai.settings.model")}</span>
            <InputText dir="ltr" value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder={MODEL_HINTS[form.provider]} />
            <small>{t("ai.settings.modelHint")}</small>
          </label>
          <label className="ai-field">
            <span>{t("ai.settings.apiKey")}</span>
            <Password inputClassName="ai-field__password" dir="ltr" value={form.apiKey ?? ""} feedback={false} toggleMask onChange={(e) => set({ apiKey: e.target.value })} placeholder={d.hasApiKey ? t("ai.settings.apiKeyStored") : t("ai.settings.apiKeyPlaceholder")} autoComplete="off" />
            <small>{t("ai.settings.apiKeyHint")}</small>
          </label>
        </section>

        <section className="erp-card ai-settings__card">
          <h2 className="erp-card__title">{t("ai.settings.behaviour")}</h2>
          <label className="ai-toggle">
            <InputSwitch checked={form.enabled} onChange={(e) => set({ enabled: e.value })} />
            <span><strong>{t("ai.settings.enabled")}</strong><small>{t("ai.settings.enabledHint")}</small></span>
          </label>
          <label className="ai-toggle">
            <InputSwitch checked={form.autoModeEnabled} onChange={(e) => set({ autoModeEnabled: e.value })} />
            <span><strong>{t("ai.settings.auto")}</strong><small>{t("ai.settings.autoHint")}</small></span>
          </label>
          <label className="ai-field">
            <span>{t("ai.settings.limit")}</span>
            <InputNumber value={form.monthlyTokenLimit ?? null} onValueChange={(e) => set({ monthlyTokenLimit: e.value ?? null })} min={1} useGrouping placeholder={t("ai.settings.noLimit")} />
          </label>
          <div className="ai-usage">
            <span>{t("ai.settings.usage")}</span>
            <strong dir="ltr">{groupThousands(String(d.usage.input + d.usage.output))}</strong>
            <small>{t("ai.settings.usageDetail", { requests: d.usage.requests })}</small>
          </div>
        </section>
      </div>

      {test.data ? (
        <div className={`ai-notice${test.data.ok && test.data.toolCalling ? " ai-notice--ok" : " ai-notice--warn"}`} role="status">
          <i className={test.data.ok ? "pi pi-check-circle" : "pi pi-times-circle"} aria-hidden="true" />
          {test.data.ok
            ? test.data.toolCalling ? t("ai.settings.testOk", { ms: test.data.ms }) : t("ai.settings.testNoTools")
            : t(`ai.error.${test.data.errorCode ?? "PROVIDER_ERROR"}`, { defaultValue: t("ai.error.PROVIDER_ERROR") })}
        </div>
      ) : null}

      <div className="ai-settings__actions">
        <Button type="button" outlined icon="pi pi-bolt" label={t("ai.settings.test")} loading={test.isPending} onClick={() => test.mutate(payload())} />
        <Button
          type="button"
          icon="pi pi-save"
          label={t("actions.save")}
          loading={save.isPending}
          onClick={() =>
            save.mutate(payload(), {
              onSuccess: (view) => { setForm({ ...withoutKey(), version: view.version }); notify({ severity: "success", key: "ai.settings.saved" }); },
              onError: (error) => notify({ severity: "error", key: `ai.error.${codeOf(error)}` }),
            })
          }
        />
      </div>
    </div>
  );
}
