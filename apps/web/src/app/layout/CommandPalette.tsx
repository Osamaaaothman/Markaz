import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "../../shared/auth/use-permissions";
import { useThemeStore } from "../../shared/theme/theme-store";
import { CREATE_ACTIONS } from "./create-actions";
import { NAV_ITEMS } from "./NavConfig";
import { useAiStore } from "../../features/ai/ai-store";
import { useAssistantVisible } from "../../features/ai/use-assistant-visible";
import { useLayoutStore } from "./layout-store";

interface Command {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon: string;
  readonly section: "pages" | "create" | "settings";
  readonly run: () => void;
}

// A keyboard-first launcher (Ctrl+K or "/"): jump to any screen, start any document, flip a setting.
// Matches what the user can see — a screen they may not open is never offered.
export function CommandPalette(): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { can, canAny } = usePermissions();
  const assistantVisible = useAssistantVisible();
  const open = useLayoutStore((s) => s.paletteOpen);
  const openPalette = useLayoutStore((s) => s.openPalette);
  const closePalette = useLayoutStore((s) => s.closePalette);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Global shortcut: Ctrl/Cmd+K anywhere, or "/" when no field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = e.target instanceof HTMLElement && (e.target.closest("input, textarea, select, [contenteditable]") !== null);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (useLayoutStore.getState().paletteOpen) closePalette();
        else openPalette();
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openPalette();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openPalette, closePalette]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => void navigate(to);
    const pages: Command[] = NAV_ITEMS.filter((item) => canAny(item.permissions ?? [])).map((item) => ({
      id: `page:${item.to}`,
      label: t(item.labelKey),
      ...(item.groupKey ? { hint: t(item.groupKey) } : {}),
      icon: item.icon,
      section: "pages" as const,
      run: go(item.to),
    }));
    const create: Command[] = CREATE_ACTIONS.filter((a) => can(a.permission)).map((a) => ({
      id: a.id,
      label: t(a.labelKey),
      icon: a.icon,
      section: "create" as const,
      run: go(a.to),
    }));
    const settings: Command[] = [
      { id: "toggle-theme", label: t("shell.toggleTheme"), icon: "pi pi-moon", section: "settings", run: toggleTheme },
      { id: "switch-language", label: t("language.switch"), icon: "pi pi-language", section: "settings", run: () => void i18n.changeLanguage(i18n.language === "ar" ? "en" : "ar") },
      { id: "design-system", label: t("shell.designSystem"), icon: "pi pi-palette", section: "settings", run: go("/design-system") },
    ];
    return [...create, ...pages, ...settings];
  }, [t, i18n, navigate, can, canAny, toggleTheme]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return commands;
    const matches = commands.filter((c) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(q));
    // Anything typed can also go straight to the AI assistant (it lands in the chat box for review).
    if (!assistantVisible) return matches;
    const ask: Command = { id: "ask-ai", label: t("ai.palette.ask", { q: query.trim() }), icon: "pi pi-sparkles", section: "create", run: () => useAiStore.getState().openPanel(query.trim()) };
    return matches.length > 0 ? [...matches, ask] : [ask];
  }, [commands, query, assistantVisible, t]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const run = (command: Command | undefined): void => {
    if (!command) return;
    closePalette();
    command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  };

  let lastSection: Command["section"] | null = null;

  return (
    <div className="mk-palette-backdrop" onMouseDown={closePalette} role="presentation">
      <div className="mk-palette" role="dialog" aria-modal="true" aria-label={t("shell.search")} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="mk-palette__search">
          <i className="pi pi-search" aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("shell.searchPlaceholder")} aria-label={t("shell.search")} />
          <kbd>Esc</kbd>
        </div>
        <ul className="mk-palette__list" ref={listRef} role="listbox">
          {results.length === 0 ? <li className="mk-palette__empty">{t("shell.noResults")}</li> : null}
          {results.map((command, index) => {
            const showHeading = command.section !== lastSection;
            lastSection = command.section;
            return (
              <li key={command.id} role="presentation">
                {showHeading ? <span className="mk-palette__heading">{t(`shell.sections.${command.section}`)}</span> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  className={`mk-palette__item${index === active ? " mk-palette__item--active" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(command)}
                >
                  <i className={command.icon} aria-hidden="true" />
                  <span className="mk-palette__label">{command.label}</span>
                  {command.hint ? <span className="mk-palette__hint">{command.hint}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mk-palette__foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> {t("shell.navigate")}</span>
          <span><kbd>Enter</kbd> {t("shell.open")}</span>
          <span><kbd>Esc</kbd> {t("shell.close")}</span>
        </div>
      </div>
    </div>
  );
}
