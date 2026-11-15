import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "../../shared/auth/use-permissions";
import { DEFAULT_GROUP_ICON, GROUP_ICONS, NAV_ITEMS, sortGroups, type NavItem } from "../../app/layout/NavConfig";

interface Section {
  readonly key: string;
  readonly labelKey: string;
  readonly icon: string;
  readonly to: string;
  readonly count: number;
}

// Cycles through six token-based accents (never an arbitrary colour) so neighbouring books read as
// distinct sections at a glance.
const ACCENTS = ["a", "b", "c", "d", "e", "f"] as const;

// One ledger book per part of the app this signed-in user may actually open: the sidebar's own groups, each
// collapsed into a single book, plus any ungrouped page (today only first-run setup). The bookmark ribbon
// shows how many screens the book holds. A section is shown only when at least one of its pages is
// permitted, and it opens straight on the first permitted page in NavConfig's own order — the same list the
// sidebar is built from, so a book can never offer a page the sidebar would hide, and a sales clerk and an
// accountant land somewhere different from the very same book.
export function ModuleTiles(): React.JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canAny } = usePermissions();

  const sections = useMemo<Section[]>(() => {
    const permitted = NAV_ITEMS.filter((item) => item.to !== "/" && canAny(item.permissions ?? []));
    const byGroup = new Map<string, NavItem[]>();
    const standalone: NavItem[] = [];
    for (const item of permitted) {
      if (item.groupKey === undefined) {
        standalone.push(item);
        continue;
      }
      const list = byGroup.get(item.groupKey) ?? [];
      list.push(item);
      byGroup.set(item.groupKey, list);
    }
    const groupSections: Section[] = sortGroups([...byGroup.keys()], []).map((key) => {
      const items = byGroup.get(key) ?? [];
      return { key, labelKey: key, icon: GROUP_ICONS[key] ?? DEFAULT_GROUP_ICON, to: items[0]!.to, count: items.length };
    });
    const standaloneSections: Section[] = standalone.map((item) => ({ key: item.to, labelKey: item.labelKey, icon: item.icon, to: item.to, count: 1 }));
    return [...standaloneSections, ...groupSections];
  }, [canAny]);

  if (sections.length === 0) return null;

  return (
    <section className="erp-card mk-tiles-card">
      <h2 className="erp-card__title">{t("dashboard.sections.title")}</h2>
      <div className="mk-tiles">
        {sections.map((s, index) => {
          const label = t(s.labelKey);
          const screens = t("dashboard.sections.count", { count: s.count });
          return (
            <button
              key={s.key}
              type="button"
              className={`mk-tile mk-tile--${ACCENTS[index % ACCENTS.length]}`}
              style={{ "--i": index } as React.CSSProperties}
              aria-label={`${label}, ${screens}`}
              onClick={() => void navigate(s.to)}
            >
              <span className="mk-tile__spine" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="mk-tile__ribbon" title={screens} aria-hidden="true">
                {s.count}
              </span>
              <span className="mk-tile__cover">
                <span className="mk-tile__icon">
                  <i className={s.icon} aria-hidden="true" />
                </span>
                <span className="mk-tile__plate">
                  <span className="mk-tile__label">{label}</span>
                </span>
                <span className="mk-tile__rules" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
