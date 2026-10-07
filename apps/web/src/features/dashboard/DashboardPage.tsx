import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { usePermissions } from "../../shared/auth/use-permissions";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { formatMoney } from "../../shared/lib/money";
import { AnimatedMoney } from "../../shared/ui/AnimatedMoney";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { MonthlyChart } from "./MonthlyChart";
import { useDashboard } from "./use-dashboard";

interface Kpi {
  readonly key: string;
  readonly label: string;
  readonly amount: string | null;
  readonly hint?: string;
  readonly tone?: "warn";
  // For receivables and payables: the share of the figure that is overdue, 0-100, drawn as a ring.
  readonly overduePercent?: number;
  readonly to: string;
  readonly icon: string;
}

interface Attention {
  readonly key: string;
  readonly text: string;
  readonly to: string;
  readonly icon: string;
}

function Ring({ percent }: { percent: number }): React.JSX.Element {
  return (
    <svg className="erp-kpi__ring" viewBox="0 0 36 36" aria-hidden="true" style={{ "--mk-ring-offset": 100 - Math.min(Math.max(percent, 0), 100) } as React.CSSProperties}>
      <circle className="mk-ring__track" cx="18" cy="18" r="15.9155" />
      <circle className="mk-ring__bar" cx="18" cy="18" r="15.9155" pathLength={100} />
    </svg>
  );
}

const share = (overdue: string, total: string): number => (Number(total) > 0 ? (Number(overdue) / Number(total)) * 100 : 0);

// The first screen. Cards link to the report behind them; "needs attention" lists only what someone has to
// act on; quick actions are the handful of things people do all day. Everything shown is permission-aware —
// the API leaves out a section the user may not read, and a button the user may not use is not drawn.
export function DashboardPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { data: currentUser } = useCurrentUser();
  const { data, isPending, isError, refetch } = useDashboard();

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

  const cur = data.currency;
  const kpis: Kpi[] = [];
  if (data.receivables) {
    const overdue = Number(data.receivables.overdue) > 0;
    kpis.push({
      key: "ar",
      label: t("dashboard.kpi.receivables"),
      amount: data.receivables.total,
      ...(overdue ? { hint: t("dashboard.kpi.overdue", { amount: formatMoney(data.receivables.overdue, cur) }), tone: "warn" as const, overduePercent: share(data.receivables.overdue, data.receivables.total) } : {}),
      to: "/accounting/aging",
      icon: "pi pi-arrow-down-left",
    });
  }
  if (data.payables) {
    const overdue = Number(data.payables.overdue) > 0;
    kpis.push({
      key: "ap",
      label: t("dashboard.kpi.payables"),
      amount: data.payables.total,
      ...(overdue ? { hint: t("dashboard.kpi.overdue", { amount: formatMoney(data.payables.overdue, cur) }), tone: "warn" as const, overduePercent: share(data.payables.overdue, data.payables.total) } : {}),
      to: "/accounting/aging",
      icon: "pi pi-arrow-up-right",
    });
  }
  if (data.cash) {
    kpis.push({
      key: "cash",
      label: t("dashboard.kpi.cash"),
      amount: data.cash.balance,
      hint: data.cash.balance === null ? t("dashboard.kpi.cashNone") : t("dashboard.kpi.cashHint"),
      to: "/accounting/balance-sheet",
      icon: "pi pi-wallet",
    });
  }
  if (data.sales) {
    kpis.push({ key: "sales", label: t("dashboard.kpi.sales"), amount: data.sales.thisMonthNet, hint: t("dashboard.kpi.salesHint"), to: "/sales/invoices", icon: "pi pi-chart-line" });
  }
  if (data.stock) {
    kpis.push({ key: "stock", label: t("dashboard.kpi.stock"), amount: data.stock.value, to: "/inventory/stock-levels", icon: "pi pi-box" });
  }

  const attention: Attention[] = [];
  if (data.purchasing && data.purchasing.pendingApprovals > 0) {
    attention.push({ key: "approvals", text: t("dashboard.attention.approvals", { count: data.purchasing.pendingApprovals }), to: "/purchasing/orders", icon: "pi pi-verified" });
  }
  if (data.purchasing && data.purchasing.pendingRequests > 0) {
    attention.push({ key: "requests", text: t("dashboard.attention.requests", { count: data.purchasing.pendingRequests }), to: "/purchasing/requests", icon: "pi pi-inbox" });
  }
  if (data.stock && data.stock.belowReorder > 0) {
    attention.push({ key: "reorder", text: t("dashboard.attention.reorder", { count: data.stock.belowReorder }), to: "/inventory/stock-levels", icon: "pi pi-exclamation-triangle" });
  }
  if (data.receivables && Number(data.receivables.overdue) > 0) {
    attention.push({ key: "overdueAr", text: t("dashboard.attention.overdueReceivables", { amount: formatMoney(data.receivables.overdue, cur) }), to: "/accounting/aging", icon: "pi pi-clock" });
  }
  if (data.payables && Number(data.payables.overdue) > 0) {
    attention.push({ key: "overdueAp", text: t("dashboard.attention.overduePayables", { amount: formatMoney(data.payables.overdue, cur) }), to: "/accounting/aging", icon: "pi pi-clock" });
  }
  if (data.sales && data.sales.openQuotations > 0) {
    attention.push({ key: "quotes", text: t("dashboard.attention.quotations", { count: data.sales.openQuotations }), to: "/sales/quotations", icon: "pi pi-file-edit" });
  }

  const actions = [
    { key: "invoice", label: t("dashboard.actions.invoice"), icon: "pi pi-receipt", to: "/sales/invoices/new", allowed: can("sales_invoice:create") },
    { key: "receipt", label: t("dashboard.actions.receipt"), icon: "pi pi-arrow-down-left", to: "/payments/receipts/new", allowed: can("customer_receipt:create") },
    { key: "po", label: t("dashboard.actions.purchaseOrder"), icon: "pi pi-shopping-cart", to: "/purchasing/orders/new", allowed: can("purchase_order:create") },
    { key: "supplierInvoice", label: t("dashboard.actions.supplierInvoice"), icon: "pi pi-file", to: "/purchasing/invoices/new", allowed: can("supplier_invoice:create") },
    { key: "journal", label: t("dashboard.actions.journal"), icon: "pi pi-book", to: "/accounting/journal-entries", allowed: can("journal_entry:create") },
  ].filter((a) => a.allowed);

  const today = new Intl.DateTimeFormat(i18n.language, { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${data.asOf}T00:00:00Z`));
  const name = currentUser?.email.split("@")[0] ?? "";

  return (
    <div className="erp-page erp-page--wide erp-dashboard">
      <section className="mk-hero">
        <div>
          <h1 className="mk-hero__title">{t("dashboard.hello", { name })}</h1>
          <p className="mk-hero__sub">
            {currentUser?.companyName} · {today}
          </p>
        </div>
        {actions.length > 0 ? (
          <div className="mk-hero__actions">
            {actions.map((a) => (
              <Button key={a.key} label={a.label} icon={a.icon} onClick={() => void navigate(a.to)} />
            ))}
          </div>
        ) : null}
      </section>

      {kpis.length === 0 && attention.length === 0 && !data.monthly ? <p className="erp-page__empty">{t("dashboard.nothingToShow")}</p> : null}

      {kpis.length > 0 ? (
        <div className="erp-kpis mk-stagger">
          {kpis.map((k, index) => (
            <button key={k.key} type="button" className={`erp-kpi${k.tone === "warn" ? " erp-kpi--warn" : ""}`} style={{ "--i": index } as React.CSSProperties} onClick={() => void navigate(k.to)}>
              {k.overduePercent !== undefined ? (
                <Ring percent={k.overduePercent} />
              ) : (
                <span className="erp-kpi__icon">
                  <i className={k.icon} aria-hidden="true" />
                </span>
              )}
              <span className="erp-kpi__label">{k.label}</span>
              <span className="erp-kpi__value">{k.amount === null ? "—" : <AnimatedMoney amount={k.amount} currency={cur} />}</span>
              {k.hint ? <span className="erp-kpi__hint">{k.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="erp-dashboard__grid">
        {data.monthly ? (
          <section className="erp-card">
            <h2 className="erp-card__title">{t("dashboard.chart.title")}</h2>
            <MonthlyChart months={data.monthly} currency={cur} />
          </section>
        ) : null}

        {data.purchasing || data.stock || data.receivables || data.payables || data.sales ? (
          <section className="erp-card">
            <h2 className="erp-card__title">{t("dashboard.attention.title")}</h2>
            {attention.length === 0 ? (
              <p className="erp-card__empty">
                <i className="pi pi-check-circle" aria-hidden="true" /> {t("dashboard.attention.allClear")}
              </p>
            ) : (
              <ul className="erp-attention mk-stagger">
                {attention.map((a, index) => (
                  <li key={a.key} style={{ "--i": index + 3 } as React.CSSProperties}>
                    <button type="button" className="erp-attention__item" onClick={() => void navigate(a.to)}>
                      <i className={a.icon} aria-hidden="true" />
                      <span>{a.text}</span>
                      <i className="pi pi-chevron-right erp-attention__chevron" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
