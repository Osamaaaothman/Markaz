import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "../../shared/auth/use-permissions";
import { CREATE_ACTIONS, type CreateAction } from "../../app/layout/create-actions";

// Daily work that the command palette does not list as a "new document": issuing stock, a cash expense, and
// the journal.
const EXTRA_ACTIONS: readonly CreateAction[] = [
  { id: "new-stock-issue", labelKey: "nav.stockIssue", to: "/inventory/stock-issues/new", icon: "pi pi-upload", permission: "stock_issue:create", group: "inventory" },
  { id: "new-cash-expense", labelKey: "nav.cashExpenses", to: "/payments/cash-expenses/new", icon: "pi pi-wallet", permission: "cash_expense:create", group: "payments" },
  { id: "journal", labelKey: "dashboard.actions.journal", to: "/accounting/journal-entries", icon: "pi pi-book", permission: "journal_entry:create", group: "accounting" },
];

const GROUP_ORDER: readonly CreateAction["group"][] = ["sales", "purchasing", "inventory", "payments", "accounting"];

// A section of its own for the things people start many times a day. Each button is offered only to a user
// who holds the permission the page behind it needs, so a clerk sees their own handful and an admin sees all
// of them; the buttons are grouped (and coloured) by the part of the app they belong to.
export function QuickActions(): React.JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = usePermissions();

  const actions = useMemo(
    () =>
      [...CREATE_ACTIONS, ...EXTRA_ACTIONS]
        .filter((a) => can(a.permission))
        .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)),
    [can],
  );

  if (actions.length === 0) return null;

  return (
    <section className="erp-card mk-actions-card">
      <h2 className="erp-card__title">{t("dashboard.quickActions.title")}</h2>
      <div className="mk-actions">
        {actions.map((a, index) => (
          <button key={a.id} type="button" className={`mk-action mk-action--${a.group}`} style={{ "--i": index } as React.CSSProperties} onClick={() => void navigate(a.to)}>
            <span className="mk-action__icon">
              <i className={a.icon} aria-hidden="true" />
            </span>
            <span className="mk-action__label">{t(a.labelKey)}</span>
            <span className="mk-action__plus" aria-hidden="true">
              <i className="pi pi-plus" />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
