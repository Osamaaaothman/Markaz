import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Checkbox } from "primereact/checkbox";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { localizedName } from "../../shared/lib/localized-name";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useApplySuggestions, useMappingSuggestions, useSetupStatus } from "./use-setup";

// What a fresh installation still needs, in the order to do it, and proposed account mappings to review and confirm.
export function SetupPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { data: status, isPending, isError, refetch } = useSetupStatus();
  const { data: suggestions } = useMappingSuggestions();
  const apply = useApplySuggestions();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string): void => setChosen((prev) => (prev.has(key) ? new Set([...prev].filter((k) => k !== key)) : new Set([...prev, key])));
  const all = (suggestions ?? []).map((s) => s.key);

  if (isPending) return <PageSkeleton />;
  if (isError || !status) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("setup.title")}</h1>
          <p className="erp-page__subtitle">{t(status.requiredDone ? "setup.readyHint" : "setup.subtitle")}</p>
        </div>
      </div>

      <section className="erp-card">
        <h2 className="erp-card__title">{t("setup.checklist")}</h2>
        <ul className="mk-checklist">
          {status.steps.map((step) => (
            <li key={step.key} className="mk-checklist__item">
              <i className={`pi ${step.done ? "pi-check-circle" : "pi-circle"} mk-checklist__icon${step.done ? " mk-checklist__icon--done" : ""}`} aria-hidden="true" />
              <div className="mk-checklist__text">
                <strong>{t(`setup.steps.${step.key}.title`)}</strong>
                <small>{t(`setup.steps.${step.key}.hint`)}</small>
              </div>
              {step.progress ? <span dir="ltr" className="mk-checklist__progress">{step.progress.done} / {step.progress.total}</span> : null}
              <Tag value={t(step.required ? "setup.required" : "setup.optional")} severity={step.required ? "warning" : "secondary"} />
              <Button type="button" label={t(step.done ? "setup.review" : "setup.open")} text onClick={() => void navigate(step.link)} />
            </li>
          ))}
        </ul>
      </section>

      <section className="erp-card">
        <h2 className="erp-card__title">{t("setup.suggestionsTitle")}</h2>
        <p className="erp-field__hint">{t("setup.suggestionsWarning")}</p>
        {suggestions && suggestions.length > 0 ? (
          <>
            <ul className="mk-checklist">
              {suggestions.map((s) => (
                <li key={s.key} className="mk-checklist__item">
                  <Checkbox inputId={`sg-${s.key}`} checked={chosen.has(s.key)} onChange={() => toggle(s.key)} />
                  <label htmlFor={`sg-${s.key}`} className="mk-checklist__text">
                    <strong>{t(`inventory.accountMapping.keys.${s.key}`)}</strong>
                    <small>
                      {s.action === "CREATE_UNDER"
                        ? t("setup.createUnder", { name: localizedName({ name: s.accountName, nameAr: s.accountNameAr }, i18n.language), code: s.accountCode, folder: `${s.folderCode} ${localizedName({ name: s.folderName, nameAr: s.folderNameAr }, i18n.language)}` })
                        : s.action === "MAP_FOLDER"
                          ? t("setup.mapFolder", { folder: `${s.folderCode} ${localizedName({ name: s.folderName, nameAr: s.folderNameAr }, i18n.language)}` })
                          : t("setup.mapExisting", { account: `${s.accountCode} ${localizedName({ name: s.accountName, nameAr: s.accountNameAr }, i18n.language)}` })}
                    </small>
                  </label>
                </li>
              ))}
            </ul>
            <div className="erp-row-actions">
              <Button type="button" label={t("setup.selectAll")} text onClick={() => setChosen(new Set(all))} />
              <PermissionButton
                allowed={can("account_mapping:update") && can("account:create")}
                label={t("setup.apply", { count: chosen.size })}
                icon="pi pi-check"
                disabled={chosen.size === 0}
                loading={apply.isPending}
                onClick={() => apply.mutate([...chosen], { onSuccess: () => setChosen(new Set()) })}
              />
            </div>
          </>
        ) : (
          <p className="erp-card__empty">{t("setup.noSuggestions")}</p>
        )}
        {apply.isSuccess ? <p className="erp-page__subtitle">{t("setup.applied", { applied: apply.data.filter((r) => r.status === "APPLIED").length, skipped: apply.data.filter((r) => r.status === "SKIPPED").length })}</p> : null}
        {apply.isError ? <p className="erp-auth-card__error">{t("setup.applyError")}</p> : null}
      </section>
    </div>
  );
}
