import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";
import { aiKeys, fetchConversation, type ChangeItem } from "./ai-api";
import { CardEditor } from "./components/CardEditor";
import { valueLabel } from "./value-label";

const ENTITY_ICON: Record<string, string> = {
  party: "pi pi-users",
  employee: "pi pi-id-card",
  item: "pi pi-box",
  account: "pi pi-sitemap",
};

type Outcome = { status: "EXECUTED"; link: { label: string; path: string } | null } | { status: "REJECTED" | "SKIPPED" } | { status: "FAILED"; errorCode: string };

// One card sent by an external AI app (MCP), opened from the notification bell: its details, and
// approve / edit / reject right here. Deciding runs the change through the same path as the chat, but
// no model reply is written (POST …/items/:key/decision).
export function McpCardDialog({ target, onClose }: { target: { conversationId: string; key: string } | null; onClose: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const perms = usePermissions();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: target ? aiKeys.conversation(target.conversationId) : ["ai", "none"],
    enabled: target !== null,
    queryFn: () => fetchConversation(target?.conversationId ?? ""),
  });
  const change: ChangeItem | undefined = detail.data?.messages.flatMap((m) => m.changes).find((c) => c.key === target?.key);
  const proposed = change?.status === "PROPOSED" && outcome === null;
  const canDecide = perms.can("ai_assistant:interact");

  const close = (): void => {
    setEditing(false);
    setOutcome(null);
    setError(null);
    onClose();
  };
  const decide = async (decision: "approve" | "reject"): Promise<void> => {
    if (!target) return;
    setBusy(decision);
    setError(null);
    try {
      const res = await apiClient.post<Outcome>(`/v1/ai/conversations/${target.conversationId}/items/${target.key}/decision`, { decision, locale: i18n.language === "ar" ? "ar" : "en" });
      setOutcome(res.data);
    } catch (e) {
      const code = isAxiosError(e) ? (e.response?.data as { code?: string } | undefined)?.code : undefined;
      setError(t(`ai.error.${code ?? "TOOL_FAILED"}`, { defaultValue: t("ai.error.TOOL_FAILED") }));
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: aiKeys.mcpActivity });
      void qc.invalidateQueries({ queryKey: aiKeys.conversation(target.conversationId) });
      void qc.invalidateQueries({ queryKey: aiKeys.conversations });
    }
  };

  const status = outcome?.status ?? change?.status;
  const link = outcome?.status === "EXECUTED" ? outcome.link : change?.link ?? null;
  const failedCode = outcome?.status === "FAILED" ? outcome.errorCode : change?.status === "FAILED" ? change.errorCode : null;

  return (
    <Dialog
      visible={target !== null}
      onHide={close}
      header={change ? t(change.preview.titleKey, { defaultValue: t(`ai.tool.${change.tool}`, { defaultValue: change.tool }) }) : t("ai.mcpBell.title")}
      className="ai-mcp-dialog"
      style={{ width: "min(34rem, 94vw)" }}
      draggable={false}
    >
      {detail.isPending ? <p className="ai-tokens__note">{t("status.loading")}</p> : null}
      {detail.isError || (detail.isSuccess && !change) ? <p className="erp-page__error">{t("ai.error.CHANGE_NOT_FOUND", { defaultValue: t("status.error") })}</p> : null}
      {change && target ? (
        <div className="ai-mcp-dialog__body">
          <div className="ai-mcp-dialog__head">
            <span className="ai-mcp-dialog__icon" aria-hidden="true"><i className={ENTITY_ICON[change.preview.entity] ?? "pi pi-pencil"} /></span>
            <div className="ai-mcp-dialog__titles">
              <span className="ai-mcp-dialog__from"><i className="pi pi-link" aria-hidden="true" /> <bdi>{detail.data?.conversation.title}</bdi></span>
              <span className="ai-mcp-dialog__pills">
                <bdi dir="ltr" className="ai-ticket__key">#{change.key}</bdi>
                {change.risk === "high" ? <span className="ai-pill ai-pill--warn"><i className="pi pi-shield" aria-hidden="true" /> {t("ai.risk.high")}</span> : null}
              </span>
            </div>
            {status && status !== "PROPOSED" ? (
              <span className={`ai-stamp ai-stamp--${status.toLowerCase()}`}>
                <i className={status === "EXECUTED" ? "pi pi-check" : status === "FAILED" ? "pi pi-exclamation-triangle" : status === "SKIPPED" ? "pi pi-forward" : "pi pi-times"} aria-hidden="true" />
                {t(`ai.change.status.${status}`)}
              </span>
            ) : null}
          </div>

          {editing ? (
            <CardEditor
              conversationId={target.conversationId}
              change={change}
              onSaved={() => { setEditing(false); void detail.refetch(); }}
              onClose={() => setEditing(false)}
            />
          ) : change.preview.fields.length > 0 ? (
            <dl className="ai-fields ai-mcp-dialog__fields">
              {change.preview.fields.map((f) => (
                <div key={f.labelKey} className="ai-fields__row">
                  <dt>{t(f.labelKey)}</dt>
                  <dd>
                    {f.before ? <span className="ai-fields__before">{valueLabel(i18n, f.before)}</span> : null}
                    {f.before ? <i className="pi pi-arrow-right ai-fields__arrow" aria-hidden="true" /> : null}
                    <span className="ai-fields__after">{valueLabel(i18n, f.value)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {change.preview.warningKeys?.map((w) => <p key={w} className="ai-ticket__note ai-ticket__note--warn"><i className="pi pi-exclamation-triangle" aria-hidden="true" /> {t(w)}</p>)}
          {failedCode ? <p className="ai-ticket__note ai-ticket__note--danger">{t(`ai.error.${failedCode}`, { defaultValue: t("ai.error.TOOL_FAILED") })}</p> : null}
          {error ? <p className="ai-ticket__note ai-ticket__note--danger">{error}</p> : null}
          {link ? (
            <Link className="ai-ticket__open" to={link.path} onClick={close}>
              <span>{t("ai.change.open", { label: link.label })}</span>
              <i className="pi pi-arrow-up-right" aria-hidden="true" />
            </Link>
          ) : null}

          {proposed && !editing ? (
            canDecide ? (
              <footer className="ai-mcp-dialog__actions">
                <Button type="button" text icon="pi pi-pencil" label={t("ai.change.edit")} disabled={busy !== null} onClick={() => setEditing(true)} />
                <span className="ai-mcp-dialog__spacer" />
                <Button type="button" outlined severity="danger" icon="pi pi-times" label={t("ai.change.reject")} loading={busy === "reject"} disabled={busy !== null} onClick={() => void decide("reject")} />
                <Button type="button" icon="pi pi-check" label={t("ai.change.approve")} loading={busy === "approve"} disabled={busy !== null} onClick={() => void decide("approve")} />
              </footer>
            ) : (
              <p className="ai-tokens__note">{t("ai.mcpBell.noDecidePermission")}</p>
            )
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
