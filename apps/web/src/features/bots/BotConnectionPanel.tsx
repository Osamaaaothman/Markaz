import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { confirmDialog } from "primereact/confirmdialog";
import { DataTable } from "primereact/datatable";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { TabPanel, TabView } from "primereact/tabview";
import { Tag } from "primereact/tag";
import { copyToClipboard } from "../../shared/lib/copy-to-clipboard";
import { useFeedbackStore } from "../../shared/lib/feedback-store";
import { CredentialFields, FeatureToggles, isDecimalInput } from "./bot-form-parts";
import {
  REPORT_TYPES,
  botErrorDetail,
  botErrorKey,
  useAddBotTarget,
  useAddTargetSubscription,
  useBotConnectionAction,
  useBotDeliveries,
  useBotLinks,
  useBotTargets,
  useRemoveBotTarget,
  useRemoveTargetSubscription,
  useRevokeBotLink,
  useUpdateBotConnection,
  type BotTransport,
  type ConnectionView,
  type ProviderInfo,
  type ReportType,
} from "./use-bots";

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

function useDateTime(): (iso: string) => string {
  const { i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(i18n.language.startsWith("ar") ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  return (iso) => format.format(new Date(iso));
}

function CopyValue({ value }: { readonly value: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <span className="bots-copy">
      <code className="bots-mono">{value}</code>
      <Button
        type="button"
        size="small"
        text
        icon={copied ? "pi pi-check" : "pi pi-copy"}
        aria-label={t(copied ? "bots.actions.copied" : "bots.actions.copy")}
        onClick={() => void copyToClipboard(value).then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })}
      />
    </span>
  );
}

interface Props {
  readonly connection: ConnectionView;
  readonly provider: ProviderInfo;
  readonly canManage: boolean;
  readonly publicUrlConfigured: boolean;
}

export function BotConnectionPanel({ connection, provider, canManage, publicUrlConfigured }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const formatDateTime = useDateTime();
  const notify = useFeedbackStore((s) => s.notify);
  const update = useUpdateBotConnection(connection.id);
  const action = useBotConnectionAction(connection.id);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [transport, setTransport] = useState<BotTransport>(connection.transport);
  const [features, setFeatures] = useState<string[]>([...connection.enabledFeatures]);
  const [ceiling, setCeiling] = useState(connection.approvalCeiling ? connection.approvalCeiling.replace(/\.?0+$/, "") : "");
  const ceilingValid = ceiling.trim() === "" || isDecimalInput(ceiling.trim());
  const healthTone = connection.lastHealthOk === null ? "secondary" : connection.lastHealthOk ? "success" : "danger";
  const healthText = connection.lastHealthOk === null ? t("bots.status.neverChecked") : t(connection.lastHealthOk ? "bots.status.healthy" : "bots.status.unhealthy");
  const updateError = update.error;
  const detail = botErrorDetail(updateError);

  const saveCredentials = () =>
    update.mutate(
      { credentials, transport },
      {
        onSuccess: () => {
          setCredentials({});
          notify({ severity: "success", key: "bots.credentials.saved" });
        },
      },
    );

  const saveFeatures = () =>
    update.mutate(
      { enabledFeatures: features, approvalCeiling: ceiling.trim() === "" ? null : ceiling.trim() },
      { onSuccess: () => notify({ severity: "success", key: "bots.featuresSaved" }) },
    );

  return (
    <section className="erp-card bots-panel" aria-label={t(`bots.providers.${connection.provider}.name`)}>
      {/* Not `scrollable`: PrimeReact places the scroll arrows physically, covering the first tab in RTL. */}
      <TabView>
        <TabPanel header={t("bots.tabs.overview")}>
          {connection.manualStepKey ? (
            <div className="bots-notice" role="note">
              <i className="pi pi-info-circle" aria-hidden="true" />
              <p style={{ margin: 0 }}>{t(connection.manualStepKey)}</p>
            </div>
          ) : null}
          <dl className="bots-detail">
            <dt>{t("bots.overview.bot")}</dt>
            <dd>{connection.identity ? `${connection.identity.displayName} · ${connection.identity.username}` : "—"}</dd>
            <dt>{t("bots.overview.transport")}</dt>
            <dd>{t(connection.transport === "webhook" ? "bots.connect.transportWebhook" : "bots.connect.transportPolling")}</dd>
            {connection.webhookUrl ? (
              <>
                <dt>{t("bots.overview.webhookUrl")}</dt>
                <dd>
                  <CopyValue value={connection.webhookUrl} />
                  <p className="bots-field__hint">{t("bots.overview.webhookUrlHelp")}</p>
                </dd>
              </>
            ) : null}
            <dt>{t("bots.overview.health")}</dt>
            <dd className="bots-copy">
              <Tag severity={healthTone === "secondary" ? "secondary" : healthTone} value={healthText} />
              {connection.lastHealthAt ? <span className="bots-field__hint">{t("bots.status.lastCheck", { time: formatDateTime(connection.lastHealthAt) })}</span> : null}
              {connection.lastHealthCode ? <span className="bots-field__hint">{t(`bots.testReasons.${connection.lastHealthCode}`, { defaultValue: connection.lastHealthCode })}</span> : null}
            </dd>
            <dt>{t("bots.tabs.users")}</dt>
            <dd>{connection.linkedUsers}</dd>
          </dl>
          <p className="bots-field__hint" style={{ marginBlockStart: "var(--mk-space-3)" }}>
            {t("bots.overview.dataSharingAccepted", { date: formatDateTime(connection.dataSharingAcceptedAt) })}
          </p>
          <div className="bots-provider__actions" style={{ marginBlockStart: "var(--mk-space-3)" }}>
            {connection.inviteUrl ? (
              <Button label={t("bots.discord.invite")} icon="pi pi-external-link" outlined onClick={() => window.open(connection.inviteUrl ?? "", "_blank", "noopener")} />
            ) : null}
            {canManage ? <Button label={t("bots.actions.reinstall")} icon="pi pi-refresh" outlined loading={action.isPending && action.variables === "install"} onClick={() => action.mutate("install")} /> : null}
          </div>
          {action.error ? <p className="bots-field__error" role="alert">{t(botErrorKey(action.error))}</p> : null}
        </TabPanel>

        <TabPanel header={t("bots.tabs.credentials")} disabled={!canManage}>
          <div className="bots-form">
            <p className="bots-field__hint">{t("bots.credentials.hint")}</p>
            <CredentialFields fields={provider.credentialFields} values={credentials} onChange={(k, v) => setCredentials((c) => ({ ...c, [k]: v }))} stored={connection} />
            {provider.transports.length > 1 ? (
              <div className="bots-field">
                <label htmlFor="bot-manage-transport">{t("bots.connect.transport")}</label>
                <Dropdown
                  inputId="bot-manage-transport"
                  value={transport}
                  onChange={(e) => setTransport(e.value as BotTransport)}
                  options={provider.transports.map((value) => ({
                    value,
                    label: t(value === "webhook" ? "bots.connect.transportWebhook" : "bots.connect.transportPolling"),
                    disabled: value === "webhook" && !publicUrlConfigured,
                  }))}
                  style={{ maxInlineSize: "320px" }}
                />
              </div>
            ) : null}
            <div>
              <Button label={t("bots.actions.save")} icon="pi pi-save" onClick={saveCredentials} loading={update.isPending} />
            </div>
            {updateError ? (
              <p className="bots-field__error" role="alert">
                {t(botErrorKey(updateError))}
                {detail ? ` — ${t(`bots.testReasons.${detail}`, { defaultValue: detail })}` : null}
              </p>
            ) : null}
          </div>
        </TabPanel>

        <TabPanel header={t("bots.tabs.features")}>
          <div className="bots-form">
            <FeatureToggles value={features} onChange={setFeatures} disabled={!canManage} />
            {features.includes("approvals") ? (
              <div className="bots-field">
                <label htmlFor="bot-manage-ceiling">{t("bots.connect.approvalCeiling")}</label>
                <InputText id="bot-manage-ceiling" dir="ltr" inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value)} disabled={!canManage} invalid={!ceilingValid} style={{ maxInlineSize: "220px" }} />
                <p className="bots-field__hint">{t("bots.connect.approvalCeilingHelp")}</p>
                {!ceilingValid ? <p className="bots-field__error">{t("bots.connect.approvalCeilingInvalid")}</p> : null}
              </div>
            ) : null}
            {canManage ? (
              <div>
                <Button label={t("bots.actions.save")} icon="pi pi-save" onClick={saveFeatures} loading={update.isPending} disabled={!ceilingValid || features.length === 0} />
              </div>
            ) : null}
          </div>
        </TabPanel>

        <TabPanel header={t("bots.tabs.users")}>
          <LinkedUsers connectionId={connection.id} canManage={canManage} />
        </TabPanel>

        <TabPanel header={t("bots.tabs.groups")}>
          <ReportGroups connectionId={connection.id} canManage={canManage} />
        </TabPanel>

        <TabPanel header={t("bots.tabs.deliveries")}>
          <Deliveries connectionId={connection.id} />
        </TabPanel>

        <TabPanel header={t("bots.tabs.danger")} disabled={!canManage}>
          <div className="bots-danger">
            <div className="bots-danger__row">
              <p>{t("bots.danger.disableHint")}</p>
              {connection.status === "ACTIVE" ? (
                <Button label={t("bots.actions.disable")} icon="pi pi-pause" severity="warning" outlined onClick={() => action.mutate("disable")} loading={action.isPending && action.variables === "disable"} />
              ) : (
                <Button label={t("bots.actions.enable")} icon="pi pi-play" severity="success" outlined onClick={() => action.mutate("enable")} loading={action.isPending && action.variables === "enable"} />
              )}
            </div>
            <div className="bots-danger__row">
              <p>{t("bots.danger.deleteHint")}</p>
              <Button
                label={t("bots.actions.delete")}
                icon="pi pi-trash"
                severity="danger"
                onClick={() =>
                  confirmDialog({
                    message: t("bots.danger.deleteConfirm"),
                    icon: "pi pi-exclamation-triangle",
                    acceptClassName: "p-button-danger",
                    acceptLabel: t("bots.actions.delete"),
                    rejectLabel: t("bots.actions.cancel"),
                    accept: () => action.mutate("delete"),
                  })
                }
              />
            </div>
          </div>
        </TabPanel>
      </TabView>
    </section>
  );
}

function LinkedUsers({ connectionId, canManage }: { readonly connectionId: string; readonly canManage: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const formatDateTime = useDateTime();
  const { data = [], isPending } = useBotLinks(connectionId);
  const revoke = useRevokeBotLink(connectionId);
  return (
    <DataTable value={[...data]} loading={isPending} size="small" stripedRows emptyMessage={t("bots.users.empty")} dataKey="id">
      <Column header={t("bots.users.user")} body={(row: (typeof data)[number]) => `${row.userEmail} · ${row.userRef}`} />
      <Column
        header={t("bots.users.handle")}
        body={(row: (typeof data)[number]) => (
          <span className="bots-copy">
            <span dir="ltr">{row.externalHandle ?? "—"}</span>
            {row.unreachable ? <Tag severity="warning" value={t("bots.users.unreachable")} /> : null}
          </span>
        )}
      />
      <Column header={t("bots.users.linkedAt")} body={(row: (typeof data)[number]) => formatDateTime(row.linkedAt)} />
      {canManage ? (
        <Column
          body={(row: (typeof data)[number]) => (
            <Button
              size="small"
              text
              severity="danger"
              label={t("bots.actions.revoke")}
              onClick={() =>
                confirmDialog({
                  message: t("bots.users.revokeConfirm"),
                  acceptLabel: t("bots.actions.revoke"),
                  rejectLabel: t("bots.actions.cancel"),
                  acceptClassName: "p-button-danger",
                  accept: () => revoke.mutate(row.id),
                })
              }
            />
          )}
        />
      ) : null}
    </DataTable>
  );
}

function ReportGroups({ connectionId, canManage }: { readonly connectionId: string; readonly canManage: boolean }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data = [], isPending } = useBotTargets(connectionId);
  const addTarget = useAddBotTarget(connectionId);
  const removeTarget = useRemoveBotTarget(connectionId);
  const addSub = useAddTargetSubscription(connectionId);
  const removeSub = useRemoveTargetSubscription(connectionId);
  const [chatId, setChatId] = useState("");
  const [title, setTitle] = useState("");
  const [reportType, setReportType] = useState<ReportType>("DAILY_SUMMARY");
  const [sendTime, setSendTime] = useState("08:00");
  const [weekday, setWeekday] = useState(0);
  const [language, setLanguage] = useState<"ar" | "en">(i18n.language.startsWith("ar") ? "ar" : "en");
  const chatIdValid = /^-?\d{1,25}$/.test(chatId.trim());

  return (
    <div className="bots-form">
      <p className="bots-field__hint">{t("bots.groups.hint")}</p>
      {canManage ? (
        <div className="bots-inline-form">
          <div className="bots-field">
            <label htmlFor="bot-target-chat">{t("bots.groups.chatId")}</label>
            <InputText id="bot-target-chat" dir="ltr" value={chatId} onChange={(e) => setChatId(e.target.value)} invalid={chatId !== "" && !chatIdValid} />
          </div>
          <div className="bots-field">
            <label htmlFor="bot-target-title">{t("bots.groups.title")}</label>
            <InputText id="bot-target-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
          </div>
          <Button
            label={t("bots.actions.add")}
            icon="pi pi-plus"
            disabled={!chatIdValid || title.trim() === ""}
            loading={addTarget.isPending}
            onClick={() => addTarget.mutate({ chatId: chatId.trim(), title: title.trim() }, { onSuccess: () => { setChatId(""); setTitle(""); } })}
          />
        </div>
      ) : null}
      {addTarget.error ? <p className="bots-field__error" role="alert">{t(botErrorKey(addTarget.error))}</p> : null}
      {!isPending && data.length === 0 ? <p className="bots-field__hint">{t("bots.groups.empty")}</p> : null}
      {data.map((target) => (
        <div key={target.id} className="bots-feature" style={{ flexDirection: "column" }}>
          <div className="bots-danger__row" style={{ inlineSize: "100%" }}>
            <strong>{target.title} <span className="bots-mono">({target.chatId})</span></strong>
            {canManage ? <Button size="small" text severity="danger" icon="pi pi-trash" aria-label={t("bots.actions.remove")} onClick={() => removeTarget.mutate(target.id)} /> : null}
          </div>
          <ul style={{ margin: 0, paddingInlineStart: "var(--mk-space-5)" }}>
            {target.subscriptions.map((sub) => (
              <li key={sub.id} className="bots-copy">
                {t(`bots.reportTypes.${sub.reportType}`)} · {sub.sendTime}
                {sub.weekday !== null ? ` · ${t(`bots.weekdays.${sub.weekday}`)}` : null} · {t(`bots.languages.${sub.language}`)}
                {canManage ? <Button size="small" text icon="pi pi-times" aria-label={t("bots.actions.remove")} onClick={() => removeSub.mutate(sub.id)} /> : null}
              </li>
            ))}
          </ul>
          {canManage ? (
            <div className="bots-inline-form">
              <Dropdown aria-label={t("bots.groups.reportType")} value={reportType} onChange={(e) => setReportType(e.value as ReportType)} options={REPORT_TYPES.map((value) => ({ value, label: t(`bots.reportTypes.${value}`) }))} />
              <Dropdown aria-label={t("bots.groups.sendTime")} value={sendTime} onChange={(e) => setSendTime(e.value as string)} options={HOURS} />
              {reportType === "WEEKLY_SUMMARY" ? (
                <Dropdown aria-label={t("bots.groups.weekday")} value={weekday} onChange={(e) => setWeekday(e.value as number)} options={[0, 1, 2, 3, 4, 5, 6].map((value) => ({ value, label: t(`bots.weekdays.${value}`) }))} />
              ) : null}
              <Dropdown aria-label={t("bots.groups.language")} value={language} onChange={(e) => setLanguage(e.value as "ar" | "en")} options={(["ar", "en"] as const).map((value) => ({ value, label: t(`bots.languages.${value}`) }))} />
              <Button
                label={t("bots.groups.addSubscription")}
                icon="pi pi-calendar-plus"
                outlined
                loading={addSub.isPending}
                onClick={() => addSub.mutate({ targetId: target.id, reportType, sendTime, weekday: reportType === "WEEKLY_SUMMARY" ? weekday : null, language, attachPdf: false })}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Deliveries({ connectionId }: { readonly connectionId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const formatDateTime = useDateTime();
  const { data = [], isPending } = useBotDeliveries(connectionId);
  return (
    <DataTable value={[...data]} loading={isPending} size="small" stripedRows emptyMessage={t("bots.deliveries.empty")} dataKey="id" paginator rows={20}>
      <Column header={t("bots.deliveries.time")} body={(row: (typeof data)[number]) => formatDateTime(row.createdAt)} />
      <Column header={t("bots.deliveries.kind")} body={(row: (typeof data)[number]) => <span className="bots-mono">{row.kind}</span>} />
      <Column
        header={t("bots.deliveries.status")}
        body={(row: (typeof data)[number]) => (
          <Tag severity={row.status === "SENT" ? "success" : row.status === "FAILED" ? "danger" : "secondary"} value={t(`bots.deliveries.states.${row.status}`)} />
        )}
      />
      <Column header={t("bots.deliveries.error")} body={(row: (typeof data)[number]) => (row.errorCode ? t(`bots.testReasons.${row.errorCode}`, { defaultValue: row.errorCode }) : "—")} />
    </DataTable>
  );
}
