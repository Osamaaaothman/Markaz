import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { ConfirmDialog } from "primereact/confirmdialog";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { BotConnectDialog } from "./BotConnectDialog";
import { BotConnectionPanel } from "./BotConnectionPanel";
import { useBotProviders, useBotsOverview, type BotProvider, type ConnectionView, type ProviderInfo } from "./use-bots";
import "./bots.css";

const LOGO: Readonly<Record<BotProvider, string>> = { telegram: "pi pi-send", discord: "pi pi-discord" };

// Settings → Chat bots (docs/BOTS-INTEGRATION-PLAN.md §8): one card per platform, a guided connect
// flow, and a manage panel per connected bot. Providers come from the server, so a new adapter
// shows up here without front-end changes.
export function BotsSettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const canManage = can("bot_connection:manage");
  const providers = useBotProviders();
  const overview = useBotsOverview();
  const [connecting, setConnecting] = useState<ProviderInfo | null>(null);
  const [managing, setManaging] = useState<string | null>(null);

  if (providers.isPending || overview.isPending) return <PageSkeleton />;
  if (providers.isError || overview.isError) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => { void providers.refetch(); void overview.refetch(); }}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }

  const data = overview.data;
  const byProvider = new Map<string, ConnectionView>(data.connections.map((c) => [c.provider, c]));
  const managed = data.connections.find((c) => c.id === managing) ?? null;
  const managedProvider = managed ? providers.data.find((p) => p.provider === managed.provider) ?? null : null;

  return (
    <div className="erp-page">
      <ConfirmDialog />
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("bots.title")}</h1>
          <p className="erp-page__subtitle">{t("bots.subtitle")}</p>
        </div>
      </div>

      {!data.encryptionKeyConfigured ? (
        <div className="bots-notice bots-notice--danger" role="alert">
          <i className="pi pi-lock" aria-hidden="true" />
          <div>
            <p className="bots-notice__title">{t("bots.setup.keyMissingTitle")}</p>
            <p style={{ margin: 0 }}>{t("bots.setup.keyMissingBody")}</p>
          </div>
        </div>
      ) : null}
      {!data.publicUrlConfigured ? (
        <div className="bots-notice" role="note">
          <i className="pi pi-globe" aria-hidden="true" />
          <p style={{ margin: 0 }}>{t("bots.setup.publicUrlMissing")}</p>
        </div>
      ) : null}
      {!data.webAppUrlConfigured ? (
        <div className="bots-notice" role="note">
          <i className="pi pi-link" aria-hidden="true" />
          <p style={{ margin: 0 }}>{t("bots.setup.webAppUrlMissing")}</p>
        </div>
      ) : null}

      <div className="bots-providers">
        {providers.data.map((provider) => {
          const connection = byProvider.get(provider.provider);
          const needsPublicUrl = !provider.transports.includes("polling") && !data.publicUrlConfigured;
          return (
            <article key={provider.provider} className={`bots-provider bots-provider--${provider.provider}`}>
              <div className="bots-provider__head">
                <span className="bots-provider__logo" aria-hidden="true"><i className={LOGO[provider.provider]} /></span>
                <div>
                  <h2 className="bots-provider__name">{t(`bots.providers.${provider.provider}.name`)}</h2>
                  <p className="bots-provider__tagline">{t(`bots.providers.${provider.provider}.tagline`)}</p>
                </div>
              </div>
              <div className="bots-provider__meta">
                {connection ? (
                  <>
                    <Tag severity={connection.status === "ACTIVE" ? "success" : "warning"} value={t(`bots.status.${connection.status}`)} />
                    {connection.identity ? <span dir="ltr">{connection.identity.username}</span> : null}
                    <span>{t("bots.linkedCount", { count: connection.linkedUsers })}</span>
                    {connection.lastHealthOk === false ? <Tag severity="danger" value={t("bots.status.unhealthy")} /> : null}
                  </>
                ) : (
                  <Tag severity="secondary" value={t("bots.status.notConnected")} />
                )}
              </div>
              <div className="bots-provider__actions">
                {connection ? (
                  <Button
                    label={t("bots.actions.manage")}
                    icon="pi pi-cog"
                    outlined={managing !== connection.id}
                    onClick={() => setManaging(managing === connection.id ? null : connection.id)}
                    aria-expanded={managing === connection.id}
                  />
                ) : canManage ? (
                  <Button label={t("bots.actions.connect")} icon="pi pi-plus" onClick={() => setConnecting(provider)} disabled={!data.encryptionKeyConfigured || needsPublicUrl} />
                ) : null}
              </div>
            </article>
          );
        })}
        <article className="bots-provider bots-provider--soon" aria-disabled="true">
          <div className="bots-provider__head">
            <span className="bots-provider__logo" aria-hidden="true"><i className="pi pi-comments" /></span>
            <div>
              <h2 className="bots-provider__name">{t("bots.providers.comingSoon.name")}</h2>
              <p className="bots-provider__tagline">{t("bots.providers.comingSoon.tagline")}</p>
            </div>
          </div>
        </article>
      </div>

      {managed && managedProvider ? (
        <BotConnectionPanel key={`${managed.id}:${managed.version}`} connection={managed} provider={managedProvider} canManage={canManage} publicUrlConfigured={data.publicUrlConfigured} />
      ) : null}

      {connecting ? <BotConnectDialog provider={connecting} publicUrlConfigured={data.publicUrlConfigured} onClose={() => setConnecting(null)} /> : null}
    </div>
  );
}
