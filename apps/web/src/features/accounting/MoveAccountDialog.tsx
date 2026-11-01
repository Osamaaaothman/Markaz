import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AxiosError } from "axios";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { localizedName } from "../../shared/lib/localized-name";
import { validMoveTargets } from "./account-tree";
import { useMoveAccount, type ChartOfAccountEntry } from "./use-chart-of-accounts";

// PrimeReact's Dropdown hands back the whole option when an option's value is null, so "top level" is a sentinel.
const TOP_LEVEL = "__top__";

const ERROR_KEYS: Readonly<Record<string, string>> = {
  TYPE_MISMATCH: "accounting.chartOfAccounts.move.errors.TYPE_MISMATCH",
  MOVE_INTO_SELF_OR_DESCENDANT: "accounting.chartOfAccounts.move.errors.MOVE_INTO_SELF_OR_DESCENDANT",
  PARENT_NOT_GROUP: "accounting.chartOfAccounts.move.errors.PARENT_NOT_GROUP",
};

// Changes the parent of one account. Only groups of the same type are offered (never the account itself or anything
// under it); the server checks the same rules again. Nothing that was posted changes: only the grouping and roll-ups.
export function MoveAccountDialog({
  account,
  initialParentId,
  chart,
  onHide,
  onMoved,
}: {
  readonly account: ChartOfAccountEntry | null;
  // Pre-selected when the account was dropped onto a group; undefined when the dialog was opened from the button.
  readonly initialParentId?: string | null | undefined;
  readonly chart: readonly ChartOfAccountEntry[];
  readonly onHide: () => void;
  readonly onMoved: (account: ChartOfAccountEntry) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const move = useMoveAccount(account?.id ?? "");
  const [target, setTarget] = useState<string>(TOP_LEVEL);

  useEffect(() => {
    if (!account) return;
    move.reset();
    setTarget(initialParentId === undefined ? (account.parentId ?? TOP_LEVEL) : (initialParentId ?? TOP_LEVEL));
  }, [account?.id, initialParentId]);

  const options = useMemo(() => {
    if (!account) return [];
    return [
      { label: t("accounting.chartOfAccounts.move.topLevel"), value: TOP_LEVEL },
      ...validMoveTargets(chart, account).map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id })),
    ];
  }, [account, chart, i18n.language, t]);

  const current = account?.parentId ? chart.find((a) => a.id === account.parentId) : undefined;
  const unchanged = account !== null && (account.parentId ?? TOP_LEVEL) === target;
  const code = move.error instanceof AxiosError ? (move.error.response?.data as { error?: { code?: string } } | undefined)?.error?.code : undefined;

  return (
    <Dialog visible={account !== null} onHide={onHide} header={t("accounting.chartOfAccounts.move.title")} className="erp-dialog" modal>
      {account ? (
        <div className="erp-form">
          <p className="mk-picture__hint" style={{ fontSize: "0.9rem" }}>
            <strong dir="ltr">{account.code}</strong> — {localizedName(account, i18n.language)}
          </p>
          <div className="erp-field">
            <label>{t("accounting.chartOfAccounts.move.current")}</label>
            <span>{current ? `${current.code} — ${localizedName(current, i18n.language)}` : t("accounting.chartOfAccounts.move.topLevel")}</span>
          </div>
          <div className="erp-field">
            <label htmlFor="moveTarget">{t("accounting.chartOfAccounts.move.newParent")}</label>
            <Dropdown inputId="moveTarget" value={target} onChange={(e) => setTarget(e.value as string)} options={options} filter appendTo="self" />
            <small className="erp-field__hint">{t("accounting.chartOfAccounts.move.hint")}</small>
          </div>
          {move.isError ? (
            <p className="erp-auth-card__error" role="alert">
              {t(code && ERROR_KEYS[code] ? ERROR_KEYS[code] : "accounting.chartOfAccounts.move.errors.generic")}
            </p>
          ) : null}
          <div className="erp-form__actions">
            <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
            <Button
              type="button"
              label={t("accounting.chartOfAccounts.move.confirm")}
              icon="pi pi-arrows-alt"
              disabled={unchanged}
              loading={move.isPending}
              onClick={() => move.mutate(target === TOP_LEVEL ? null : target, { onSuccess: (moved) => onMoved(moved) })}
            />
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
