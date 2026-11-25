import { isAxiosError } from "axios";
import { Button } from "primereact/button";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { InputText } from "primereact/inputtext";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "../../shared/lib/copy-to-clipboard";
import { useFeedbackStore } from "../../shared/lib/feedback-store";
import { formatDateTime } from "../../shared/lib/format-date";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useAccessTokens, useCreateAccessToken, useRevokeAccessToken } from "./ai-api";
import "./ai.css";

const KNOWN_ERRORS = new Set(["NAME_REQUIRED", "TOO_MANY_TOKENS", "TOKEN_NOT_FOUND"]);

function errorKey(error: unknown): string {
  const code = isAxiosError(error) ? (error.response?.data as { code?: string } | undefined)?.code : undefined;
  return `ai.accessTokens.errors.${code && KNOWN_ERRORS.has(code) ? code : "UNKNOWN"}`;
}

// Settings → MCP access tokens: the signed-in user's own tokens for Claude Desktop / Claude Code.
// A new token is held only in this component's state, shown once, and gone when the page is left.
export function AiAccessTokensPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const tokens = useAccessTokens();
  const create = useCreateAccessToken();
  const revoke = useRevokeAccessToken();
  const notify = useFeedbackStore((s) => s.notify);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  if (tokens.isPending) return <PageSkeleton />;
  if (tokens.isError) return <div className="erp-page"><p className="erp-page__error">{t("status.error")}</p></div>;

  const mcpUrl = `${window.location.origin}/api/v1/ai/mcp`;
  const command = created ? `claude mcp add --transport http markaz ${mcpUrl} --header "Authorization: Bearer ${created}"` : "";
  const copy = async (text: string): Promise<void> => {
    if (await copyToClipboard(text)) notify({ severity: "success", key: "ai.accessTokens.copied" });
  };
  const submit = (): void => {
    create.mutate(name, {
      onSuccess: (row) => { setCreated(row.token); setName(""); },
      onError: (error) => notify({ severity: "error", key: errorKey(error) }),
    });
  };

  return (
    <div className="erp-page ai-settings">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("ai.accessTokens.title")}</h1>
          <p className="erp-page__subtitle">{t("ai.accessTokens.subtitle")}</p>
        </div>
      </div>

      <section className="erp-card ai-settings__card">
        <h2 className="erp-card__title">{t("ai.accessTokens.create")}</h2>
        <form className="ai-token-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label className="ai-field">
            <span>{t("ai.accessTokens.name")}</span>
            <InputText value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("ai.accessTokens.namePlaceholder")} />
          </label>
          <Button type="submit" icon="pi pi-key" label={t("ai.accessTokens.createButton")} loading={create.isPending} disabled={!name.trim()} />
        </form>

        {created ? (
          <div className="ai-notice ai-notice--warn ai-token-new" role="status">
            <strong>{t("ai.accessTokens.newTitle")}</strong>
            <span>{t("ai.accessTokens.newWarning")}</span>
            <div className="ai-token-new__row">
              <code dir="ltr" className="ai-token-new__value">{created}</code>
              <Button type="button" size="small" outlined icon="pi pi-copy" label={t("ai.accessTokens.copy")} onClick={() => void copy(created)} />
            </div>
            <span>{t("ai.accessTokens.command")}</span>
            <div className="ai-token-new__row">
              <code dir="ltr" className="ai-token-new__value">{command}</code>
              <Button type="button" size="small" outlined icon="pi pi-copy" label={t("ai.accessTokens.copy")} onClick={() => void copy(command)} />
            </div>
          </div>
        ) : null}
      </section>

      <section className="erp-card ai-settings__card">
        <h2 className="erp-card__title">{t("ai.accessTokens.listTitle")}</h2>
        {tokens.data.length === 0 ? (
          <p className="erp-page__subtitle">{t("ai.accessTokens.empty")}</p>
        ) : (
          <table className="ai-token-table">
            <thead>
              <tr>
                <th>{t("ai.accessTokens.colName")}</th>
                <th>{t("ai.accessTokens.colPrefix")}</th>
                <th>{t("ai.accessTokens.colCreated")}</th>
                <th>{t("ai.accessTokens.colLastUsed")}</th>
                <th aria-label={t("ai.accessTokens.revoke")} />
              </tr>
            </thead>
            <tbody>
              {tokens.data.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td><code dir="ltr">{row.tokenPrefix}…</code></td>
                  <td>{formatDateTime(row.createdAt, i18n.language)}</td>
                  <td>{row.lastUsedAt ? formatDateTime(row.lastUsedAt, i18n.language) : t("ai.accessTokens.never")}</td>
                  <td>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {/* Grouped so it never answers another page's dialog. */}
      <ConfirmDialog group="ai-tokens" className="ai-confirm" />
    </div>
  );
}
