import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { formatMoney } from "../../shared/lib/money";
import { AnimatedMoney } from "../../shared/ui/AnimatedMoney";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { MonthlyChart } from "./MonthlyChart";
import { ModuleTiles, type TileNote } from "./ModuleTiles";
import { QuickActions } from "./QuickActions";
import { Sparkline } from "./Sparkline";
import { Reveal } from "../../shared/ui/Reveal";
import { CompositionDonut } from "./CompositionDonut";
import { ActivityPulse, type PulseBar } from "./ActivityPulse";
import { useDashboard } from "./use-dashboard";
import { localizedName } from "../../shared/lib/localized-name";

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
  // Revenue of the last months, drawn as a small trend line under the figure.
  readonly spark?: readonly number[];
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
    kpis.push({
      key: "sales",
      label: t("dashboard.kpi.sales"),
      amount: data.sales.thisMonthNet,
      hint: t("dashboard.kpi.salesHint"),
      to: "/sales/invoices",
      icon: "pi pi-chart-line",
      ...(data.monthly ? { spark: data.monthly.map((m) => Number(m.revenue)) } : {}),
    });
  }
  if (data.stock) {
    kpis.push({ key: "stock", label: t("dashboard.kpi.stock"), amount: data.stock.value, to: "/inventory/stock-levels", icon: "pi pi-box" });
  }

  const attention: Attention[] = [];
  if (data.purchasing && data.purchasing.pendingApprovals > 0) {
    attention.push({ key: "approvals", text: t("dashboard.attention.approvals", { count: data.purchasing.pendingApprovals }), to: "/purchasing/orders", icon: "pi pi-verified" });
  }
  if (data.purchasing && data.purchasing.pendingRequests > 0) {
    attention.push({ key: "requests", text: t("dashboard.attention.requests", { count: data.purchasing.pendingRequests }), to: "/purchasing/review", icon: "pi pi-inbox" });
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

  const today = new Intl.DateTimeFormat(i18n.language, { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${data.asOf}T00:00:00Z`));
  const name = currentUser?.email.split("@")[0] ?? "";
  const roleNames = currentUser?.roles.map((r) => r.name).join(" · ") ?? "";

  // A sticky note on the book of any section that has work waiting. Each exists only when the API sent that
  // count, so — like the cards above — a note never reveals a queue the user may not read.
  const tileNotes: Record<string, TileNote> = {};
  if (data.purchasing && data.purchasing.pendingApprovals > 0) {
    tileNotes["nav.groups.purchasing"] = { text: t("dashboard.notes.approvals", { count: data.purchasing.pendingApprovals }), tone: "warn" };
  } else if (data.purchasing && data.purchasing.pendingRequests > 0) {
    tileNotes["nav.groups.purchasing"] = { text: t("dashboard.notes.requests", { count: data.purchasing.pendingRequests }), tone: "warn" };
  }
  if (data.stock && data.stock.belowReorder > 0) {
    tileNotes["nav.groups.inventory"] = { text: t("dashboard.notes.reorder", { count: data.stock.belowReorder }), tone: "danger" };
  }
  if (data.sales && data.sales.openQuotations > 0) {
    tileNotes["nav.groups.sales"] = { text: t("dashboard.notes.quotations", { count: data.sales.openQuotations }), tone: "info" };
  }

  // Every pending count this user may see, in one ranked strip — see ActivityPulse. A bar appears only
  // for a count the API actually sent (the same permission gate as the KPIs and the attention list
  // above), so this never shows a queue the user has no right to read.
  const pulseBars: PulseBar[] = [
    ...(data.purchasing ? [{ key: "approvals" as const, label: t("dashboard.pulse.approvals"), icon: "pi pi-verified", count: data.purchasing.pendingApprovals, to: "/purchasing/orders" }] : []),
    ...(data.purchasing ? [{ key: "requests" as const, label: t("dashboard.pulse.requests"), icon: "pi pi-inbox", count: data.purchasing.pendingRequests, to: "/purchasing/review" }] : []),
    ...(data.purchasing ? [{ key: "purchaseOrders" as const, label: t("dashboard.pulse.purchaseOrders"), icon: "pi pi-shopping-cart", count: data.purchasing.openOrders, to: "/purchasing/orders" }] : []),
    ...(data.sales ? [{ key: "quotations" as const, label: t("dashboard.pulse.quotations"), icon: "pi pi-file-edit", count: data.sales.openQuotations, to: "/sales/quotations" }] : []),
    ...(data.sales ? [{ key: "salesOrders" as const, label: t("dashboard.pulse.salesOrders"), icon: "pi pi-shopping-bag", count: data.sales.openOrders, to: "/sales/orders" }] : []),
    ...(data.stock ? [{ key: "reorder" as const, label: t("dashboard.pulse.reorder"), icon: "pi pi-exclamation-triangle", count: data.stock.belowReorder, to: "/inventory/stock-levels" }] : []),
  ];

  return (
    <div className="erp-page erp-page--wide erp-dashboard">
      <section className="mk-hero">
        <div>
          <h1 className="mk-hero__title">{t("dashboard.hello", { name })}</h1>
          <p className="mk-hero__sub">
            {currentUser ? localizedName({ name: currentUser.companyName, nameAr: currentUser.companyNameAr }, i18n.language) : ""} · {today}
            {roleNames ? <span className="mk-hero__role">{t("dashboard.roleLabel", { role: roleNames })}</span> : null}
          </p>
        </div>
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
              {k.spark ? <Sparkline values={k.spark} /> : null}
            </button>
          ))}
        </div>
      ) : null}

      <ModuleTiles notes={tileNotes} />

      <QuickActions />

      <div className="mk-bento">
        {data.monthly ? (
          <Reveal className="erp-card mk-bento__wide">
            <h2 className="erp-card__title">{t("dashboard.chart.title")}</h2>
            <MonthlyChart months={data.monthly} currency={cur} />
          </Reveal>
        ) : null}

        <CompositionDonut receivables={data.receivables?.total} payables={data.payables?.total} cash={data.cash?.balance} currency={cur} />

        <ActivityPulse bars={pulseBars} onNavigate={(to) => void navigate(to)} />

        {data.purchasing || data.stock || data.receivables || data.payables || data.sales ? (
          <section className="erp-card mk-bento__wide">
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
