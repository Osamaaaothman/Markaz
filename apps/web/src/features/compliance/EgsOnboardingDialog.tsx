import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { usePermissions } from "../../shared/auth/use-permissions";
import {
  useEgsUnit,
  useRenewCertificate,
  useRequestProductionCsid,
  useRunComplianceChecks,
  useStartOnboarding,
  type OnboardingStepResult,
} from "./use-compliance";

// Walks an EGS unit through the four onboarding steps (CSR -> compliance CSID -> compliance
// checks -> production CSID), and lets an ACTIVE unit renew. Each step's own result (success,
// failure with ZATCA's error, or the per-sample compliance-check results) stays visible once run
// — docs/zatca/HANDOFF.md "show each step's result."
export function EgsOnboardingDialog({ egsUnitId, visible, onHide }: { readonly egsUnitId: string; readonly visible: boolean; readonly onHide: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const { data: egs, refetch } = useEgsUnit(egsUnitId);
  const [otp, setOtp] = useState("");
  const [lastResult, setLastResult] = useState<OnboardingStepResult | null>(null);

  const start = useStartOnboarding();
  const checks = useRunComplianceChecks();
  const production = useRequestProductionCsid();
  const renew = useRenewCertificate();
  const running = start.isPending || checks.isPending || production.isPending || renew.isPending;
  // A thrown HTTP error (e.g. 503 ENCRYPTION_KEY_MISSING, a network failure) is a different shape from the
  // documented `{ok:false, error}` step outcome StepResult renders below -- it never reaches `onSuccess`, so
  // without this the dialog would fail completely silently (found via manual testing, see docs/06 §6).
  const requestFailed = start.isError || checks.isError || production.isError || renew.isError;

  if (!egs) return <Dialog visible={visible} onHide={onHide} header={t("compliance.onboarding.title")} />;

  const status = egs.credentialStatus ?? "NEW";
  const otpValid = /^\d+$/.test(otp) && otp.length > 0;

  function run(mutation: typeof start, needsOtp: boolean): void {
    const args = needsOtp ? { egsUnitId, otp } : { egsUnitId };
    mutation.mutate(args, {
      onSuccess: (result) => {
        setLastResult(result);
        void refetch();
        if (result.ok) setOtp("");
      },
    });
  }

  return (
    <Dialog header={t("compliance.onboarding.titleFor", { name: egs.name })} visible={visible} onHide={onHide} className="erp-dialog" modal style={{ width: "min(40rem, 96vw)" }}>
      <div className="erp-form">
        <p className="erp-field__hint">{t(`compliance.onboarding.hint.${status}`, { defaultValue: t("compliance.onboarding.hint.default") })}</p>

        {status === "NEW" || status === "CSR_GENERATED" ? (
          <div className="erp-form__row">
            <div className="erp-field">
              <label htmlFor="eo-otp">{t("compliance.onboarding.otp")}</label>
              <InputText id="eo-otp" dir="ltr" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder={t("compliance.onboarding.otpPlaceholder")} />
            </div>
            <PermissionButton allowed={can("compliance:manage")} label={t("compliance.onboarding.step1")} icon="pi pi-key" disabled={!otpValid} loading={start.isPending} onClick={() => run(start, true)} />
          </div>
        ) : null}

        {status === "COMPLIANCE_CSID_ISSUED" ? (
          <div className="erp-form__actions">
            <PermissionButton allowed={can("compliance:manage")} label={t("compliance.onboarding.step2")} icon="pi pi-check-square" loading={checks.isPending} onClick={() => run(checks, false)} />
          </div>
        ) : null}

        {status === "COMPLIANCE_CHECKS_PASSED" ? (
          <div className="erp-form__actions">
            <PermissionButton allowed={can("compliance:manage")} label={t("compliance.onboarding.step3")} icon="pi pi-verified" loading={production.isPending} onClick={() => run(production, false)} />
          </div>
        ) : null}

        {status === "ACTIVE" ? (
          <>
            <p className="erp-page__subtitle">{t("compliance.onboarding.active")}</p>
            <div className="erp-form__row">
              <div className="erp-field">
                <label htmlFor="eo-renew-otp">{t("compliance.onboarding.otp")}</label>
                <InputText id="eo-renew-otp" dir="ltr" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder={t("compliance.onboarding.otpPlaceholder")} />
              </div>
              <PermissionButton allowed={can("compliance:manage")} label={t("compliance.onboarding.renew")} icon="pi pi-refresh" disabled={!otpValid} loading={renew.isPending} onClick={() => run(renew, true)} />
            </div>
          </>
        ) : null}

        {requestFailed ? <p className="erp-auth-card__error">{t("compliance.onboarding.requestError")}</p> : null}
        {lastResult ? <StepResult result={lastResult} /> : null}

        <div className="erp-form__actions">
          <Button type="button" label={t("actions.close")} text onClick={onHide} disabled={running} />
        </div>
      </div>
    </Dialog>
  );
}

function StepResult({ result }: { readonly result: OnboardingStepResult }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={`erp-card ${result.ok ? "erp-card--success" : "erp-card--error"}`}>
      <div className="erp-card__header">
        <Tag value={t(`compliance.onboarding.steps.${result.step}`)} severity={result.ok ? "success" : "danger"} />
      </div>
      {result.checks ? (
        <ul className="mk-checklist">
          {result.checks.map((c) => (
            <li key={c.label} className="mk-checklist__item">
              <i className={`pi ${c.ok ? "pi-check-circle" : "pi-times-circle"}`} aria-hidden="true" />
              <div className="mk-checklist__text">
                <strong>{t(`compliance.complianceSamples.${c.label}`, { defaultValue: c.label })}</strong>
                {c.message ? <small>{c.message}</small> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {result.error ? <p className="erp-auth-card__error">{result.error.message}</p> : null}
    </div>
  );
}
