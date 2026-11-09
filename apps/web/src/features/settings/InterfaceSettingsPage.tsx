import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { DEFAULT_GROUP_ICON, GROUP_ICONS, SIDEBAR_GROUPS, sortGroups } from "../../app/layout/NavConfig";
import { useLayoutStore } from "../../app/layout/layout-store";
import { THEMES, useThemeStore, type ThemeId } from "../../shared/theme/theme-store";

// Preview colours mirror design/themes.css so a card can show its theme without applying it.
const SWATCHES: Readonly<Record<ThemeId, { bg: string; surface: string; brand: string; accent: string }>> = {
  forest: { bg: "#f6f5f2", surface: "#ffffff", brand: "#1d583f", accent: "#b08a2e" },
  classic: { bg: "#f6f5f2", surface: "#1b1a17", brand: "#1d583f", accent: "#b08a2e" },
  ocean: { bg: "#f2f6fb", surface: "#ffffff", brand: "#1c449f", accent: "#0e8fa8" },
  sand: { bg: "#faf5ee", surface: "#fffdf9", brand: "#9c411b", accent: "#9b8a22" },
  plum: { bg: "#f7f4fb", surface: "#ffffff", brand: "#5a2ba0", accent: "#d94a7b" },
  night: { bg: "#131210", surface: "#1b1a17", brand: "#54987a", accent: "#c9aa5c" },
  graphite: { bg: "#0f1116", surface: "#181b24", brand: "#7c85f5", accent: "#5cc8d8" },
  prime: { bg: "#f8f9fa", surface: "#ffffff", brand: "#6366f1", accent: "#14b8a6" },
  primedark: { bg: "#111827", surface: "#1f2937", brand: "#818cf8", accent: "#2dd4bf" },
};

// Personal interface preferences: the order of the sidebar's sections, and other display settings.
// All of it lives in this browser's localStorage (layout-store.ts) — nothing here is sent to the
// server or shared between users, so everyone can open this page regardless of role.
export function InterfaceSettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const groupOrder = useLayoutStore((state) => state.groupOrder);
  const setGroupOrder = useLayoutStore((state) => state.setGroupOrder);
  const resetGroupOrder = useLayoutStore((state) => state.resetGroupOrder);
  const orderedGroups = sortGroups(SIDEBAR_GROUPS, groupOrder);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= orderedGroups.length) return;
    const next = [...orderedGroups];
    const moved = next.splice(index, 1)[0]!;
    next.splice(target, 0, moved);
    setGroupOrder(next);
  }

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("interfaceSettings.title")}</h1>
          <p className="erp-page__subtitle">{t("interfaceSettings.subtitle")}</p>
        </div>
      </div>

      <section className="erp-card">
        <h2 className="erp-card__title">{t("interfaceSettings.theme")}</h2>
        <p className="erp-card__empty" style={{ textAlign: "start" }}>
          {t("interfaceSettings.themeHint")}
        </p>
        <div className="mk-theme-grid" role="radiogroup" aria-label={t("interfaceSettings.theme")}>
          {THEMES.map(({ id, mode }) => {
            const swatch = SWATCHES[id];
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={theme === id}
                className={`mk-theme-card${theme === id ? " mk-theme-card--active" : ""}`}
                onClick={() => setTheme(id)}
              >
                <span className="mk-theme-card__preview" style={{ background: swatch.bg }} aria-hidden="true">
                  <span className="mk-theme-card__side" style={{ background: swatch.surface }} />
                  <span className="mk-theme-card__body">
                    <span className="mk-theme-card__bar" style={{ background: swatch.surface }} />
                    <span className="mk-theme-card__dots">
                      <span style={{ background: swatch.brand }} />
                      <span style={{ background: swatch.accent }} />
                    </span>
                  </span>
                </span>
                <span className="mk-theme-card__name">{t(`interfaceSettings.themes.${id}`)}</span>
                <span className="mk-theme-card__mode">{t(mode === "dark" ? "interfaceSettings.modeDark" : "interfaceSettings.modeLight")}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="erp-card">
        <h2 className="erp-card__title">{t("interfaceSettings.sidebarOrder")}</h2>
        <p className="erp-card__empty" style={{ textAlign: "start" }}>
          {t("interfaceSettings.sidebarOrderHint")}
        </p>
        <ul className="mk-reorder-list">
          {orderedGroups.map((groupKey, index) => (
            <li key={groupKey} className="mk-reorder-list__item">
              <i className={`${GROUP_ICONS[groupKey] ?? DEFAULT_GROUP_ICON} mk-reorder-list__icon`} aria-hidden="true" />
              <span className="mk-reorder-list__label">{t(groupKey)}</span>
              <span className="mk-reorder-list__actions">
                <Button
                  type="button"
                  icon="pi pi-angle-up"
                  rounded
                  text
                  disabled={index === 0}
                  aria-label={t("interfaceSettings.moveUp", { section: t(groupKey) })}
                  onClick={() => move(index, -1)}
                />
                <Button
                  type="button"
                  icon="pi pi-angle-down"
                  rounded
                  text
                  disabled={index === orderedGroups.length - 1}
                  aria-label={t("interfaceSettings.moveDown", { section: t(groupKey) })}
                  onClick={() => move(index, 1)}
                />
              </span>
            </li>
          ))}
        </ul>
        <Button type="button" label={t("interfaceSettings.resetOrder")} icon="pi pi-replay" text onClick={resetGroupOrder} disabled={groupOrder.length === 0} />
      </section>
    </div>
  );
}
