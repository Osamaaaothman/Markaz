import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { ChangeItem } from "../ai-api";

type Decision = "approve" | "reject";

const ENTITY_ICON: Record<string, string> = {
  party: "pi pi-users",
  employee: "pi pi-id-card",
  item: "pi pi-box",
  account: "pi pi-sitemap",
};

const STATUS_ICON: Record<string, string> = {
  EXECUTED: "pi pi-check-circle",
  REJECTED: "pi pi-times-circle",
  SKIPPED: "pi pi-forward",
  FAILED: "pi pi-exclamation-triangle",
};

function shown(t: (k: string) => string, value: string): string {
  return value.startsWith("ai.") ? t(value) : value;
}

// The review step of interactive mode: one card per proposed change, with a before/after view,
// approve / edit / reject on each, and a sticky bar for the whole batch. High-risk changes are never
// included in "approve all" — each one needs its own click.
export function ChangeCards({ changes, busy, onDecide }: { changes: ChangeItem[]; busy: boolean; onDecide: (d: Record<string, Decision>, edits: Record<string, Record<string, unknown>>) => void }): React.JSX.Element | null {
  const { t } = useTranslation();
  const pending = changes.filter((c) => c.status === "PROPOSED");
  const [choice, setChoice] = useState<Record<string, Decision>>({});
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [editing, setEditing] = useState<string | null>(null);

  // A change whose dependency is rejected cannot run either; show it as such before submitting.
  const blockedBy = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of pending) {
      const dep = c.dependsOn.find((d) => choice[d] === "reject");
      if (dep) out[c.key] = dep;
    }
    return out;
  }, [pending, choice]);

  if (changes.length === 0) return null;
  const decidedAll = pending.length > 0 && pending.every((c) => choice[c.key] !== undefined || blockedBy[c.key]);

  const submit = (all?: Decision): void => {
    const decisions: Record<string, Decision> = {};
    for (const c of pending) {
      const picked = all === "approve" && c.risk === "high" ? choice[c.key] ?? "reject" : all ?? choice[c.key] ?? "reject";
      decisions[c.key] = blockedBy[c.key] ? "reject" : picked;
    }
    onDecide(decisions, edits);
  };

  return (
    <div className="ai-changes">
      {changes.map((c, index) => {
        const pick = choice[c.key];
        const state = c.status !== "PROPOSED" ? c.status.toLowerCase() : blockedBy[c.key] ? "blocked" : pick ?? "pending";
        const isEditing = editing === c.key;
        const editable = Object.entries(c.args).filter(([, v]) => typeof v === "string" && !String(v).startsWith("$ref:"));
        return (
          <article key={c.key} className={`ai-change ai-change--${state} ai-change--risk-${c.risk}`} style={{ animationDelay: `${index * 60}ms` }}>
            <header className="ai-change__head">
              <span className="ai-change__icon"><i className={ENTITY_ICON[c.preview.entity] ?? "pi pi-pencil"} aria-hidden="true" /></span>
              <span className="ai-change__title">{t(c.preview.titleKey)}</span>
              <span className="ai-change__key">{c.key}</span>
              {c.risk === "high" ? <span className="ai-badge ai-badge--warn">{t("ai.risk.high")}</span> : null}
              {edits[c.key] && c.status === "PROPOSED" ? <span className="ai-badge">{t("ai.change.edited")}</span> : null}
              {c.auto ? <span className="ai-badge ai-badge--auto"><i className="pi pi-bolt" aria-hidden="true" /> {t("ai.change.auto")}</span> : null}
              {c.status !== "PROPOSED" ? (
                <span className={`ai-change__status ai-change__status--${c.status.toLowerCase()}`}>
                  <i className={STATUS_ICON[c.status]} aria-hidden="true" /> {t(`ai.change.status.${c.status}`)}
                </span>
              ) : null}
            </header>

            {c.preview.fields.length > 0 && !isEditing ? (
              <dl className="ai-diff">
                {c.preview.fields.map((f) => (
                  <div key={f.labelKey} className="ai-diff__row">
                    <dt>{t(f.labelKey)}</dt>
                    <dd>
                      {f.before ? <span className="ai-diff__before">{shown(t, f.before)}</span> : null}
                      <span className="ai-diff__after">{shown(t, f.value)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {isEditing ? (
              <div className="ai-edit">
                {editable.map(([key, value]) => (
                  <label key={key} className="ai-edit__field">
                    <span>{t(`ai.arg.${key}`, { defaultValue: key })}</span>
                    <InputText
                      value={String(edits[c.key]?.[key] ?? value)}
                      onChange={(e) => setEdits((all) => ({ ...all, [c.key]: { ...(all[c.key] ?? {}), [key]: e.target.value } }))}
                    />
                  </label>
                ))}
                <Button type="button" size="small" label={t("ai.change.doneEditing")} icon="pi pi-check" onClick={() => setEditing(null)} />
              </div>
            ) : null}

            {c.preview.warningKeys?.map((w) => <p key={w} className="ai-change__warn"><i className="pi pi-exclamation-triangle" aria-hidden="true" /> {t(w)}</p>)}
            {blockedBy[c.key] ? <p className="ai-change__warn">{t("ai.change.blocked", { key: blockedBy[c.key] })}</p> : null}
            {c.status === "FAILED" && c.errorCode ? <p className="ai-change__warn">{t(`ai.error.${c.errorCode}`, { defaultValue: t("ai.error.TOOL_FAILED") })}</p> : null}
            {c.link ? (
              <Link className="ai-change__link" to={c.link.path}>
                <i className="pi pi-external-link" aria-hidden="true" /> {t("ai.change.open", { label: c.link.label })}
              </Link>
            ) : null}

            {c.status === "PROPOSED" && !blockedBy[c.key] ? (
              <footer className="ai-change__actions">
                <Button type="button" size="small" disabled={busy} severity={pick === "approve" ? "success" : undefined} outlined={pick !== "approve"} icon="pi pi-check" label={t("ai.change.approve")} onClick={() => setChoice((x) => ({ ...x, [c.key]: "approve" }))} />
                {editable.length > 0 ? <Button type="button" size="small" disabled={busy} text icon="pi pi-pencil" label={t("ai.change.edit")} onClick={() => setEditing(isEditing ? null : c.key)} /> : null}
                <Button type="button" size="small" disabled={busy} text severity="danger" icon="pi pi-times" label={t("ai.change.reject")} onClick={() => setChoice((x) => ({ ...x, [c.key]: "reject" }))} />
              </footer>
            ) : null}
          </article>
        );
      })}

      {pending.length > 0 ? (
        <div className="ai-batch">
          <span className="ai-batch__count">{t("ai.change.pending", { count: pending.length })}</span>
          <span className="ai-batch__spacer" />
          <Button type="button" size="small" text severity="danger" disabled={busy} label={t("ai.change.rejectAll")} onClick={() => submit("reject")} />
          {decidedAll ? (
            <Button type="button" size="small" disabled={busy} icon="pi pi-send" label={t("ai.change.submit")} onClick={() => submit()} />
          ) : (
            <Button type="button" size="small" disabled={busy} icon="pi pi-check-square" label={pending.some((c) => c.risk === "high") ? t("ai.change.approveLow") : t("ai.change.approveAll")} onClick={() => submit("approve")} />
          )}
        </div>
      ) : null}
    </div>
  );
}
