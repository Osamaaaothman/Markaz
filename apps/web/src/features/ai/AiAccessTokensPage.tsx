import { isAxiosError } from "axios";
import { Button } from "primereact/button";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { TabPanel, TabView } from "primereact/tabview";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePermissions } from "../../shared/auth/use-permissions";
import { copyToClipboard } from "../../shared/lib/copy-to-clipboard";
import { useFeedbackStore } from "../../shared/lib/feedback-store";
import { formatDateTime } from "../../shared/lib/format-date";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useAccessTokens, useCreateAccessToken, useRevokeAccessToken, type AccessTokenScope } from "./ai-api";
import "./ai.css";

const KNOWN_ERRORS = new Set(["NAME_REQUIRED", "TOO_MANY_TOKENS", "TOKEN_NOT_FOUND", "FORBIDDEN"]);
// Each token type, its icon, and the chat permission it needs (the same as the matching chat mode).
const SCOPES: ReadonlyArray<{ scope: AccessTokenScope; permission: string; icon: string }> = [
  { scope: "read", permission: "ai_assistant:use", icon: "pi pi-eye" },
  { scope: "review", permission: "ai_assistant:interact", icon: "pi pi-check-square" },
  { scope: "write", permission: "ai_assistant:auto", icon: "pi pi-bolt" },
];
const SCOPE_ICON: Record<AccessTokenScope, string> = { read: "pi pi-eye", review: "pi pi-check-square", write: "pi pi-bolt" };

function errorKey(error: unknown): string {
  const code = isAxiosError(error) ? (error.response?.data as { code?: string } | undefined)?.code : undefined;
  return `ai.accessTokens.errors.${code && KNOWN_ERRORS.has(code) ? code : "UNKNOWN"}`;
}

// A value the user copies into another app: shown as-is (left to right), with a copy button.
function CopyField({ value, block, onCopy, copyLabel }: { value: string; block?: boolean; onCopy: (v: string) => void; copyLabel: string }): React.JSX.Element {
  return (
    <div className={`ai-copy${block ? " ai-copy--block" : ""}`}>
      {block ? <pre dir="ltr">{value}</pre> : <code dir="ltr">{value}</code>}
      <button type="button" className="ai-copy__btn" onClick={() => onCopy(value)} aria-label={copyLabel} title={copyLabel}>
        <i className="pi pi-copy" aria-hidden="true" />
      </button>
    </div>
  );
}

// Settings → AI apps (MCP): the signed-in user's own tokens for any MCP client (Claude, Cursor, VS Code, ...).
// A new token lives only in this component's state, is shown once in a dialog, and is gone when it closes.
export function AiAccessTokensPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const tokens = useAccessTokens();
  const create = useCreateAccessToken();
  const revoke = useRevokeAccessToken();
  const notify = useFeedbackStore((s) => s.notify);
  const perms = usePermissions();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<AccessTokenScope>("read");
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);

  if (tokens.isPending) return <PageSkeleton />;
  if (tokens.isError) return <div className="erp-page"><p className="erp-page__error">{t("status.error")}</p></div>;

  const mcpUrl = `${window.location.origin}/api/v1/ai/mcp`;
  const copy = async (text: string): Promise<void> => {
    if (await copyToClipboard(text)) notify({ severity: "success", key: "ai.accessTokens.copied" });
  };
  const submit = (): void => {
    create.mutate({ name, scope }, {
      onSuccess: (row) => { setCreated({ token: row.token, name: row.name }); setName(""); },
      onError: (error) => notify({ severity: "error", key: errorKey(error) }),
    });
  };
  // Any MCP client that speaks Streamable HTTP with a bearer header can connect; these are the common forms.
  const token = created?.token ?? "";
  const jsonConfig = JSON.stringify({ mcpServers: { markaz: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
  const command = `claude mcp add --transport http markaz ${mcpUrl} --header "Authorization: Bearer ${token}"`;
  const copyLabel = t("ai.accessTokens.copy");

  return (
    <div className="erp-page ai-tokens">
      <header className="ai-tokens__hero">
        <span className="ai-tokens__hero-icon" aria-hidden="true"><i className="pi pi-link" /></span>
        <div>
          <h1 className="erp-page__title">{t("ai.accessTokens.title")}</h1>
          <p className="erp-page__subtitle">{t("ai.accessTokens.subtitle")}</p>
        </div>
      </header>

      <div className="ai-tokens__grid">
        <section className="erp-card ai-tokens__card">
          <h2 className="ai-tokens__card-title"><i className="pi pi-plus-circle" aria-hidden="true" /> {t("ai.accessTokens.create")}</h2>
          <form className="ai-tokens__form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label className="ai-field">
              <span>{t("ai.accessTokens.name")}</span>
              <InputText value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("ai.accessTokens.namePlaceholder")} />
            </label>
            <div className="ai-field">
              <span>{t("ai.accessTokens.scope")}</span>
              <div className="ai-scope-grid" role="radiogroup" aria-label={t("ai.accessTokens.scope")}>
                {SCOPES.map((s) => {
                  const allowed = perms.can(s.permission);
                  return (
                    <button
                      key={s.scope}
                      type="button"
                      role="radio"
                      aria-checked={scope === s.scope}
                      disabled={!allowed}
                      className={`ai-scope ai-scope--${s.scope}${scope === s.scope ? " is-active" : ""}`}
                      onClick={() => setScope(s.scope)}
                    >
                      <span className="ai-scope__icon" aria-hidden="true"><i className={s.icon} /></span>
                      <strong>{t(`ai.accessTokens.scopes.${s.scope}`)}</strong>
                      <small>{allowed ? t(`ai.accessTokens.scopeHints.${s.scope}`) : t("ai.accessTokens.errors.FORBIDDEN")}</small>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="ai-tokens__actions">
              <Button type="submit" icon="pi pi-key" label={t("ai.accessTokens.createButton")} loading={create.isPending} disabled={!name.trim()} />
            </div>
          </form>
        </section>

        <aside className="erp-card ai-tokens__card ai-tokens__server">
          <h2 className="ai-tokens__card-title"><i className="pi pi-server" aria-hidden="true" /> {t("ai.accessTokens.serverUrl")}</h2>
          <CopyField value={mcpUrl} onCopy={(v) => void copy(v)} copyLabel={copyLabel} />
          <p className="ai-tokens__note">{t("ai.accessTokens.serverHint")}</p>
        </aside>
      </div>

      <section className="erp-card ai-tokens__card">
        <h2 className="ai-tokens__card-title">
          <i className="pi pi-key" aria-hidden="true" /> {t("ai.accessTokens.listTitle")}
          <span className="ai-tokens__count">{tokens.data.length}</span>
        </h2>
        {tokens.data.length === 0 ? (
          <div className="ai-tokens__empty">
            <i className="pi pi-key" aria-hidden="true" />
            <p>{t("ai.accessTokens.empty")}</p>
          </div>
        ) : (
          <ul className="ai-token-list">
            {tokens.data.map((row) => (
              <li key={row.id} className="ai-token-row">
                <span className={`ai-token-row__icon ai-scope--${row.scope}`} aria-hidden="true"><i className={SCOPE_ICON[row.scope]} /></span>
                <div className="ai-token-row__main">
                  <div className="ai-token-row__top">
                    <strong>{row.name}</strong>
                    <span className={`ai-token-chip ai-token-chip--${row.scope}`}>{t(`ai.accessTokens.scopes.${row.scope}`)}</span>
                  </div>
                  <div className="ai-token-row__meta">
                    <code dir="ltr">{row.tokenPrefix}…</code>
                    <span>{t("ai.accessTokens.colCreated")}: <bdi>{formatDateTime(row.createdAt, i18n.language)}</bdi></span>
                    <span>{t("ai.accessTokens.colLastUsed")}: <bdi>{row.lastUsedAt ? formatDateTime(row.lastUsedAt, i18n.language) : t("ai.accessTokens.never")}</bdi></span>
                  </div>
                </div>
                <Button
                  type="button"
                  size="small"
                  text
                  severity="danger"
                  icon="pi pi-ban"
                  label={t("ai.accessTokens.revoke")}
                  onClick={() =>
                    confirmDialog({
                      group: "ai-tokens",
                      header: t("ai.accessTokens.revoke"),
                      message: t("ai.accessTokens.confirmRevoke"),
                      icon: "pi pi-exclamation-triangle",
                      acceptLabel: t("ai.accessTokens.revoke"),
                      rejectLabel: t("actions.cancel"),
                      acceptClassName: "p-button-danger",
                      defaultFocus: "reject",
                      accept: () =>
                        revoke.mutate(row.id, {
                          onSuccess: () => notify({ severity: "success", key: "ai.accessTokens.revoked" }),
                          onError: (error) => notify({ severity: "error", key: errorKey(error) }),
                        }),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        visible={created !== null}
        onHide={() => setCreated(null)}
        header={t("ai.accessTokens.newTitle")}
        className="ai-token-dialog"
        style={{ width: "min(40rem, 94vw)" }}
        dismissableMask={false}
        draggable={false}
      >
        {created ? (
          <div className="ai-token-dialog__body">
            <div className="ai-token-dialog__warn"><i className="pi pi-exclamation-triangle" aria-hidden="true" /> {t("ai.accessTokens.newWarning")}</div>
            <label className="ai-field">
              <span>{t("ai.accessTokens.tokenFor", { name: created.name })}</span>
              <CopyField value={created.token} onCopy={(v) => void copy(v)} copyLabel={copyLabel} />
            </label>
            <p className="ai-tokens__note">{t("ai.accessTokens.howTo")}</p>
            <TabView className="ai-token-tabs">
              <TabPanel header={t("ai.accessTokens.tabJson")}>
                <p className="ai-tokens__note">{t("ai.accessTokens.jsonConfig")}</p>
                <CopyField value={jsonConfig} block onCopy={(v) => void copy(v)} copyLabel={copyLabel} />
              </TabPanel>
              <TabPanel header={t("ai.accessTokens.tabClaudeCode")}>
                <p className="ai-tokens__note">{t("ai.accessTokens.claudeCode")}</p>
                <CopyField value={command} block onCopy={(v) => void copy(v)} copyLabel={copyLabel} />
              </TabPanel>
              <TabPanel header={t("ai.accessTokens.tabManual")}>
                <div className="ai-token-dialog__manual">
                  <label className="ai-field"><span>{t("ai.accessTokens.serverUrl")}</span><CopyField value={mcpUrl} onCopy={(v) => void copy(v)} copyLabel={copyLabel} /></label>
                  <label className="ai-field"><span>{t("ai.accessTokens.header")}</span><CopyField value={`Authorization: Bearer ${created.token}`} onCopy={(v) => void copy(v)} copyLabel={copyLabel} /></label>
                </div>
              </TabPanel>
            </TabView>
            <div className="ai-tokens__actions">
              <Button type="button" label={t("ai.accessTokens.done")} icon="pi pi-check" onClick={() => setCreated(null)} />
            </div>
          </div>
        ) : null}
      </Dialog>
      {/* Grouped so it never answers another page's dialog. */}
      <ConfirmDialog group="ai-tokens" className="ai-confirm" />
    </div>
  );
}
