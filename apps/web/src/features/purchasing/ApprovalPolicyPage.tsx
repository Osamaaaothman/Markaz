import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useApprovalPolicies, useSetApprovalPolicy, type ApprovalPolicyEntry } from "./use-purchasing";

const AMOUNT = /^\d{1,15}(\.\d{1,4})?$/;

// One row per document type that can wait for approval. An empty threshold means "never needs
// approval"; an order whose total is above the threshold waits for someone with the approve right.
export function ApprovalPolicyPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useApprovalPolicies();

  if (isPending) return <PageSkeleton />;
  if (isError || !data) {
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
          <h1 className="erp-page__title">{t("purchasing.approvals.title")}</h1>
          <p className="erp-page__subtitle">{t("purchasing.approvals.subtitle")}</p>
        </div>
      </div>
      <div className="erp-form">
        {data.map((policy) => (
          <PolicyRow key={policy.subjectType} policy={policy} />
        ))}
      </div>
    </div>
  );
}

function PolicyRow({ policy }: { policy: ApprovalPolicyEntry }): React.JSX.Element {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const save = useSetApprovalPolicy();
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue(policy.thresholdAmount === null ? "" : policy.thresholdAmount.replace(/\.?0+$/, ""));
  }, [policy.thresholdAmount]);

  const trimmed = value.trim();
  const invalid = trimmed !== "" && !AMOUNT.test(trimmed);
  const editable = can("approval_policy:update");

  return (
    <div className="erp-field">
      <label htmlFor={`policy-${policy.subjectType}`}>{t(`purchasing.approvals.subjects.${policy.subjectType}`)}</label>
      <small className="erp-field__hint">
        {policy.thresholdAmount === null
          ? t("purchasing.approvals.noThreshold")
          : t("purchasing.approvals.currentThreshold", { amount: formatMoney(policy.thresholdAmount, policy.currency) })}
      </small>
      <div className="erp-row-actions">
        <InputText
          id={`policy-${policy.subjectType}`}
          dir="ltr"
          value={value}
          disabled={!editable}
          placeholder={t("purchasing.approvals.thresholdPlaceholder", { currency: policy.currency })}
          className={invalid ? "p-invalid" : ""}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button
          type="button"
          label={t("actions.save")}
          disabled={!editable || invalid}
          loading={save.isPending}
          onClick={() => save.mutate({ subjectType: policy.subjectType, thresholdAmount: trimmed === "" ? null : trimmed })}
        />
      </div>
      {invalid ? <small className="erp-field__error">{t("validation.positiveAmount")}</small> : null}
      {save.isError ? <small className="erp-field__error">{t("purchasing.approvals.saveError")}</small> : null}
    </div>
  );
}
