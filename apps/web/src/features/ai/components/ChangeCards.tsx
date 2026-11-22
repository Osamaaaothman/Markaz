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

function shown(t: (k: string) => string, value: string): string {
  return value.startsWith("ai.") ? t(value) : value;
}

// The review step of interactive mode. Each proposed change is a "ticket": entity icon, what will be
// written, and a two-way toggle (reject ✕ | ✓ approve) that slides to the user's choice. A floating bar
// shows how many are decided with a progress ring and sends them together. High-risk changes are never
// included in "approve all" — each one needs its own click.
export function ChangeCards({ changes, busy, onDecide }: { changes: ChangeItem[]; busy: boolean; onDecide: (d: Record<string, Decision>, edits: Record<string, Record<string, unknown>>) => void }): React.JSX.Element | null {
  const { t } = useTranslation();
  const pending = changes.filter((c) => c.status === "PROPOSED");
  const [choice, setChoice] = useState<Record<string, Decision>>({});
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [editing, setEditing] = useState<string | null>(null);

  // A change whose dependency is rejected cannot run either; show it before submitting.
  const blockedBy = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of pending) {
      const dep = c.dependsOn.find((d) => choice[d] === "reject");
      if (dep) out[c.key] = dep;
    }
    return out;
  }, [pending, choice]);

  if (changes.length === 0) return null;
  const decided = pending.filter((c) => choice[c.key] !== undefined || blockedBy[c.key]).length;
  const progress = pending.length ? decided / pending.length : 0;

  const submit = (all?: Decision): void => {
    const decisions: Record<string, Decision> = {};
    for (const c of pending) {
      const picked = all === "approve" && c.risk === "high" ? choice[c.key] ?? "reject" : all ?? choice[c.key] ?? "reject";
      decisions[c.key] = blockedBy[c.key] ? "reject" : picked;
    }
    onDecide(decisions, edits);
  };

  return (
    <div className="ai-tickets">
      {changes.map((c, index) => {
        const pick = choice[c.key];
        const state = c.status !== "PROPOSED" ? c.status.toLowerCase() : blockedBy[c.key] ? "blocked" : pick ?? "pending";
        const isEditing = editing === c.key;
        // Only plain text the user can sensibly change: never ids, file references or $ref links.
        const editable = Object.entries(c.args).filter(([k, v]) => typeof v === "string" && !String(v).startsWith("$ref:") && !/(Id|FileId)$/.test(k));
        const dependsLabel = c.dependsOn.length ? c.dependsOn.join(", ") : null;
        return (
          <article key={c.key} className={`ai-ticket ai-ticket--${state} ai-ticket--risk-${c.risk}`} style={{ animationDelay: `${index * 90}ms` }}>
            <div className="ai-ticket__glow" aria-hidden="true" />
            <header className="ai-ticket__head">
              <span className="ai-ticket__icon"><i className={ENTITY_ICON[c.preview.entity] ?? "pi pi-pencil"} aria-hidden="true" /></span>
              <div className="ai-ticket__titles">
                <span className="ai-ticket__title">{t(c.preview.titleKey, { defaultValue: t(`ai.tool.${c.tool}`, { defaultValue: c.tool }) })}</span>
                <span className="ai-ticket__meta">
                  <bdi className="ai-ticket__key" dir="ltr">#{c.key}</bdi>
                  {dependsLabel ? <span><i className="pi pi-link" aria-hidden="true" /> {t("ai.change.dependsOn", { key: dependsLabel })}</span> : null}
                  {edits[c.key] && c.status === "PROPOSED" ? <span className="ai-pill">{t("ai.change.edited")}</span> : null}
                  {c.risk === "high" ? <span className="ai-pill ai-pill--warn"><i className="pi pi-shield" aria-hidden="true" /> {t("ai.risk.high")}</span> : null}
                  {c.auto ? <span className="ai-pill ai-pill--auto"><i className="pi pi-bolt" aria-hidden="true" /> {t("ai.change.auto")}</span> : null}
                </span>
              </div>
              {c.status !== "PROPOSED" ? (
                <span className={`ai-stamp ai-stamp--${c.status.toLowerCase()}`}>
                  <i className={c.status === "EXECUTED" ? "pi pi-check" : c.status === "FAILED" ? "pi pi-exclamation-triangle" : c.status === "SKIPPED" ? "pi pi-forward" : "pi pi-times"} aria-hidden="true" />
                  {t(`ai.change.status.${c.status}`)}
                </span>
              ) : null}
            </header>

            {c.preview.fields.length > 0 && !isEditing ? (
              <dl className="ai-fields">
                {c.preview.fields.map((f, fi) => (
                  <div key={f.labelKey} className="ai-fields__row" style={{ animationDelay: `${index * 90 + fi * 40}ms` }}>
                    <dt>{t(f.labelKey)}</dt>
                    <dd>
                      {f.before ? <span className="ai-fields__before">{shown(t, f.before)}</span> : null}
                      {f.before ? <i className="pi pi-arrow-right ai-fields__arrow" aria-hidden="true" /> : null}
                      <span className="ai-fields__after">{shown(t, f.value)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {isEditing ? (
              <div className="ai-edit">
                {editable.map(([key, value]) => (
                  <label key={key} className="ai-edit__field">
                    <span>{t(`ai.arg.${key}`, { defaultValue: t(`ai.col.${key}`, { defaultValue: key }) })}</span>
                    <InputText value={String(edits[c.key]?.[key] ?? value)} onChange={(e) => setEdits((all) => ({ ...all, [c.key]: { ...(all[c.key] ?? {}), [key]: e.target.value } }))} />
                  </label>
                ))}
                <button type="button" className="ai-btn ai-btn--primary" onClick={() => setEditing(null)}><i className="pi pi-check" aria-hidden="true" /> {t("ai.change.doneEditing")}</button>
              </div>
            ) : null}

            {c.preview.warningKeys?.map((w) => <p key={w} className="ai-ticket__note ai-ticket__note--warn"><i className="pi pi-exclamation-triangle" aria-hidden="true" /> {t(w)}</p>)}
            {blockedBy[c.key] ? <p className="ai-ticket__note"><i className="pi pi-ban" aria-hidden="true" /> {t("ai.change.blocked", { key: blockedBy[c.key] })}</p> : null}
            {c.status === "FAILED" && c.errorCode ? <p className="ai-ticket__note ai-ticket__note--danger">{t(`ai.error.${c.errorCode}`, { defaultValue: t("ai.error.TOOL_FAILED") })}</p> : null}
            {c.link ? (
              <Link className="ai-ticket__open" to={c.link.path}>
                <span>{t("ai.change.open", { label: c.link.label })}</span>
                <i className="pi pi-arrow-up-right" aria-hidden="true" />
              </Link>
            ) : null}

            {c.status === "PROPOSED" && !blockedBy[c.key] ? (
              <footer className="ai-ticket__foot">
                {editable.length > 0 ? (
                  <button type="button" className={`ai-btn ai-btn--ghost${isEditing ? " is-on" : ""}`} disabled={busy} onClick={() => setEditing(isEditing ? null : c.key)}>
                    <i className="pi pi-pencil" aria-hidden="true" /> {t("ai.change.edit")}
                  </button>
                ) : <span />}
                <div className={`ai-toggle2 ai-toggle2--${pick ?? "none"}`} role="radiogroup" aria-label={t(c.preview.titleKey)}>
                  <span className="ai-toggle2__thumb" aria-hidden="true" />
                  <button type="button" role="radio" aria-checked={pick === "reject"} disabled={busy} onClick={() => setChoice((x) => ({ ...x, [c.key]: "reject" }))}>
                    <i className="pi pi-times" aria-hidden="true" /> {t("ai.change.reject")}
                  </button>
                  <button type="button" role="radio" aria-checked={pick === "approve"} disabled={busy} onClick={() => setChoice((x) => ({ ...x, [c.key]: "approve" }))}>
                    <i className="pi pi-check" aria-hidden="true" /> {t("ai.change.approve")}
                  </button>
                </div>
              </footer>
            ) : null}
          </article>
        );
      })}

      {pending.length > 0 ? (
        <div className="ai-dock">
          <span className="ai-dock__ring" style={{ "--p": progress } as React.CSSProperties} aria-hidden="true">
            <span>{decided}/{pending.length}</span>
          </span>
          <span className="ai-dock__label">{t("ai.change.pending", { count: pending.length })}</span>
          <span className="ai-dock__spacer" />
          <div className="ai-dock__actions">
          <button type="button" className="ai-btn ai-btn--ghost ai-btn--danger" disabled={busy} onClick={() => submit("reject")}>{t("ai.change.rejectAll")}</button>
          {decided === pending.length ? (
            <button type="button" className="ai-btn ai-btn--primary" disabled={busy} onClick={() => submit()}><i className="pi pi-send" aria-hidden="true" /> {t("ai.change.submit")}</button>
          ) : (
            <button type="button" className="ai-btn ai-btn--primary" disabled={busy} onClick={() => submit("approve")}>
              <i className="pi pi-check-circle" aria-hidden="true" /> {pending.some((c) => c.risk === "high") ? t("ai.change.approveLow") : t("ai.change.approveAll")}
            </button>
          )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
