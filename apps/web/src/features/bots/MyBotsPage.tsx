import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { Message } from "primereact/message";
import { Tag } from "primereact/tag";
import { copyToClipboard } from "../../shared/lib/copy-to-clipboard";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PanelLoader } from "../../shared/ui/Loading";
import {
  ALERT_TYPES,
  REPORT_TYPES,
  botErrorKey,
  useCreateLinkCode,
  useMyBots,
  useSubscribeMine,
  useUnlinkMine,
  useUnsubscribeMine,
  useUpdateMyPreferences,
  type LinkCode,
  type MyBotView,
  type ReportType,
  type SubscriptionView,
} from "./use-bots";
import "./my-bots.css";

// Hourly slots for quiet hours and for a report's send time: "00:00" … "23:00".
// These are data values, not display text, so they are never translated.
const HOURS: readonly string[] = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
const LANGUAGES = ["ar", "en"] as const;
const WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

type MyBotLink = NonNullable<MyBotView["link"]>;

function asLanguageOrNull(value: unknown): "ar" | "en" | null {
  return value === "ar" || value === "en" ? value : null;
}

function asHour(value: unknown): string {
  return typeof value === "string" ? value : (HOURS[0] ?? "00:00");
}

function asWeekday(value: unknown): number {
  return typeof value === "number" && WEEKDAYS.includes(value) ? value : 0;
}

function asReportType(value: unknown): ReportType {
  return REPORT_TYPES.find((type) => type === value) ?? "DAILY_SUMMARY";
}

// The signed-in user's own chat accounts: link a Telegram/Discord account, then set the
// language, quiet hours, alert types and scheduled reports they receive in that chat.
export function MyBotsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useMyBots();

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("bots.mine.title")}</h1>
          <p className="erp-page__subtitle">{t("bots.mine.subtitle")}</p>
        </div>
      </div>

      {isPending ? (
        <PanelLoader />
      ) : isError ? (
        <Message severity="error" text={t("bots.errors.UNKNOWN")} />
      ) : data.length === 0 ? (
        <EmptyState icon="pi pi-comments" title={t("bots.mine.noBots")} />
      ) : (
        <div className="my-bots__list">
          {data.map((bot) => (
            <MyBotCard key={bot.connectionId} bot={bot} onRefresh={() => void refetch()} />
          ))}
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}

function MyBotCard({ bot, onRefresh }: { bot: MyBotView; onRefresh: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const link = bot.link;

  return (
    <section className="erp-card">
      <div className="my-bots__head">
        <div className="my-bots__identity">
          <h2 className="erp-card__title my-bots__title">{t(`bots.providers.${bot.provider}.name`)}</h2>
          {bot.botUsername ? (
            <bdi className="my-bots__handle" dir="ltr">
              {bot.botUsername}
            </bdi>
          ) : null}
        </div>
        {link ? (
          <Tag severity="success" value={t("bots.mine.linked", { handle: link.externalHandle ?? "" })} />
        ) : (
          <Tag value={t("bots.mine.notLinked")} />
        )}
      </div>

      {link?.unreachable ? <Message severity="warn" text={t("bots.mine.unreachable")} /> : null}

      {link ? (
        <>
          <BotAccountActions link={link} />
          <BotPreferences link={link} />
          {bot.enabledFeatures.includes("reports") ? (
            <BotReports connectionId={bot.connectionId} subscriptions={bot.subscriptions} language={link.language} />
          ) : null}
        </>
      ) : (
        <BotLinkFlow connectionId={bot.connectionId} onRefresh={onRefresh} />
      )}
    </section>
  );
}

function BotLinkFlow({ connectionId, onRefresh }: { connectionId: string; onRefresh: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const createCode = useCreateLinkCode();
  const [code, setCode] = useState<LinkCode | null>(null);

  return (
    <div className="my-bots__section">
      <div className="my-bots__row">
        <Button
          type="button"
          label={t("bots.mine.link")}
          icon="pi pi-link"
          loading={createCode.isPending}
          onClick={() => {
            createCode.mutate(
              { connectionId, language: i18n.language.startsWith("ar") ? "ar" : "en" },
              { onSuccess: (created) => setCode(created) },
            );
          }}
        />
      </div>

      {createCode.isError ? <Message severity="error" text={t(botErrorKey(createCode.error))} /> : null}

      {code ? <LinkCodePanel code={code} onRefresh={onRefresh} /> : null}
    </div>
  );
}

function LinkCodePanel({ code, onRefresh }: { code: LinkCode; onRefresh: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = async (value: string): Promise<void> => {
    if (!(await copyToClipboard(value))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const expires = new Intl.DateTimeFormat(i18n.language, { timeStyle: "short" }).format(new Date(code.expiresAt));

  return (
    <div className="my-bots__panel">
      <h3 className="my-bots__panel-title">{t("bots.mine.codeTitle")}</h3>

      {code.provider === "telegram" && code.deepLink ? (
        <div className="my-bots__row">
          <Button
            type="button"
            link
            icon="pi pi-send"
            label={t("bots.mine.codeOpenTelegram")}
            onClick={() => {
              if (code.deepLink) window.open(code.deepLink, "_blank", "noopener");
            }}
          />
        </div>
      ) : null}

      <p className="my-bots__hint">
        {t(code.provider === "telegram" ? "bots.mine.codeTelegramHint" : "bots.mine.codeDiscordHint")}
      </p>

      <div className="my-bots__code">
        <code dir="ltr">{code.command}</code>
        <Button
          type="button"
          size="small"
          outlined
          icon={copied ? "pi pi-check" : "pi pi-copy"}
          label={copied ? t("bots.actions.copied") : t("bots.actions.copy")}
          onClick={() => void onCopy(code.command)}
        />
      </div>

      <p className="my-bots__hint">{t("bots.mine.codeExpires", { time: expires })}</p>

      <Button
        type="button"
        outlined
        icon="pi pi-refresh"
        label={t("bots.mine.refreshAfterLink")}
        onClick={onRefresh}
      />
    </div>
  );
}

function BotAccountActions({ link }: { link: MyBotLink }): React.JSX.Element {
  const { t } = useTranslation();
  const unlink = useUnlinkMine();

  return (
    <div className="my-bots__row">
      <Button
        type="button"
        outlined
        severity="danger"
        icon="pi pi-unlink"
        label={t("bots.mine.unlink")}
        loading={unlink.isPending}
        onClick={() =>
          confirmDialog({
            message: t("bots.mine.unlinkConfirm"),
            acceptLabel: t("actions.confirm"),
            rejectLabel: t("bots.actions.cancel"),
            accept: () => unlink.mutate(link.id),
          })
        }
      />
    </div>
  );
}

function BotPreferences({ link }: { link: MyBotLink }): React.JSX.Element {
  const { t } = useTranslation();
  const update = useUpdateMyPreferences();
  const quietOn = link.quietHoursStart !== null && link.quietHoursEnd !== null;
  const quietFrom = link.quietHoursStart ?? "22:00";
  const quietTo = link.quietHoursEnd ?? "07:00";

  return (
    <div className="my-bots__section">
      <h3 className="my-bots__section-title">{t("bots.mine.preferences")}</h3>

      <div className="my-bots__row">
        <div className="my-bots__field">
          <label htmlFor={`language-${link.id}`}>{t("bots.mine.language")}</label>
          <Dropdown
            inputId={`language-${link.id}`}
            ariaLabel={t("bots.mine.language")}
            value={link.language}
            options={LANGUAGES.map((value) => ({ label: t(`bots.languages.${value}`), value }))}
            onChange={(event) => {
              const language = asLanguageOrNull(event.value);
              if (language) update.mutate({ linkId: link.id, language });
            }}
          />
        </div>
      </div>

      <div className="my-bots__switch">
        <InputSwitch
          inputId={`quiet-${link.id}`}
          checked={quietOn}
          onChange={(event) =>
            update.mutate({
              linkId: link.id,
              quietHoursStart: event.value ? quietFrom : null,
              quietHoursEnd: event.value ? quietTo : null,
            })
          }
        />
        <label htmlFor={`quiet-${link.id}`}>{t("bots.mine.quietHours")}</label>
      </div>

      {quietOn ? (
        <div className="my-bots__row">
          <div className="my-bots__field">
            <label htmlFor={`quiet-from-${link.id}`}>{t("bots.mine.quietFrom")}</label>
            <Dropdown
              inputId={`quiet-from-${link.id}`}
              ariaLabel={t("bots.mine.quietFrom")}
              value={quietFrom}
              options={HOURS.map((value) => ({ label: value, value }))}
              onChange={(event) =>
                update.mutate({ linkId: link.id, quietHoursStart: asHour(event.value), quietHoursEnd: quietTo })
              }
            />
          </div>
          <div className="my-bots__field">
            <label htmlFor={`quiet-to-${link.id}`}>{t("bots.mine.quietTo")}</label>
            <Dropdown
              inputId={`quiet-to-${link.id}`}
              ariaLabel={t("bots.mine.quietTo")}
              value={quietTo}
              options={HOURS.map((value) => ({ label: value, value }))}
              onChange={(event) =>
                update.mutate({ linkId: link.id, quietHoursStart: quietFrom, quietHoursEnd: asHour(event.value) })
              }
            />
          </div>
        </div>
      ) : null}

      <h4 className="my-bots__subsection-title">{t("bots.mine.alerts")}</h4>
      <div className="my-bots__switches">
        {ALERT_TYPES.map((type) => {
          const id = `alert-${link.id}-${type}`;
          const enabled = !link.disabledAlerts.includes(type);
          return (
            <div className="my-bots__switch" key={type}>
              <InputSwitch
                inputId={id}
                checked={enabled}
                onChange={() =>
                  update.mutate({
                    linkId: link.id,
                    disabledAlerts: enabled
                      ? [...link.disabledAlerts, type]
                      : link.disabledAlerts.filter((alert) => alert !== type),
                  })
                }
              />
              <label htmlFor={id}>{t(`bots.alertTypes.${type}`)}</label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BotReports({
  connectionId,
  subscriptions,
  language,
}: {
  connectionId: string;
  subscriptions: readonly SubscriptionView[];
  language: "ar" | "en";
}): React.JSX.Element {
  const { t } = useTranslation();
  const subscribe = useSubscribeMine();
  const unsubscribe = useUnsubscribeMine();
  const [reportType, setReportType] = useState<ReportType>("DAILY_SUMMARY");
  const [sendTime, setSendTime] = useState<string>("08:00");
  const [weekday, setWeekday] = useState<number>(0);
  const weekly = reportType === "WEEKLY_SUMMARY";

  return (
    <div className="my-bots__section">
      <h3 className="my-bots__section-title">{t("bots.mine.reports")}</h3>

      {subscriptions.length === 0 ? (
        <p className="my-bots__hint">{t("bots.mine.noReports")}</p>
      ) : (
        <ul className="my-bots__reports">
          {subscriptions.map((subscription) => (
            <li className="my-bots__report" key={subscription.id}>
              <span>
                {t(`bots.reportTypes.${subscription.reportType}`)} · <bdi dir="ltr">{subscription.sendTime}</bdi>
                {subscription.weekday !== null ? (
                  <> · {t(`bots.weekdays.${subscription.weekday}`)}</>
                ) : null}
              </span>
              <Button
                type="button"
                text
                rounded
                severity="danger"
                icon="pi pi-trash"
                aria-label={t("bots.actions.remove")}
                loading={unsubscribe.isPending}
                onClick={() => unsubscribe.mutate(subscription.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="my-bots__row">
        <div className="my-bots__field">
          <Dropdown
            ariaLabel={t("bots.groups.reportType")}
            value={reportType}
            options={REPORT_TYPES.map((value) => ({ label: t(`bots.reportTypes.${value}`), value }))}
            onChange={(event) => setReportType(asReportType(event.value))}
          />
        </div>
        <div className="my-bots__field">
          <Dropdown
            ariaLabel={t("bots.groups.sendTime")}
            value={sendTime}
            options={HOURS.map((value) => ({ label: value, value }))}
            onChange={(event) => setSendTime(asHour(event.value))}
          />
        </div>
        {weekly ? (
          <div className="my-bots__field">
            <Dropdown
              ariaLabel={t("bots.groups.weekday")}
              value={weekday}
              options={WEEKDAYS.map((value) => ({ label: t(`bots.weekdays.${value}`), value }))}
              onChange={(event) => setWeekday(asWeekday(event.value))}
            />
          </div>
        ) : null}
        <Button
          type="button"
          icon="pi pi-calendar-plus"
          label={t("bots.mine.addReport")}
          loading={subscribe.isPending}
          onClick={() =>
            subscribe.mutate({
              connectionId,
              reportType,
              sendTime,
              weekday: weekly ? weekday : null,
              language,
              attachPdf: false,
            })
          }
        />
      </div>
    </div>
  );
}
