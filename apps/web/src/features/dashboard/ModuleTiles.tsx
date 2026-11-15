import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "../../shared/auth/use-permissions";
import { playPaper, readSoundPreference, unlockAudio, writeSoundPreference } from "../../shared/lib/page-sound";
import { DEFAULT_GROUP_ICON, GROUP_ICONS, NAV_ITEMS, sortGroups, type NavItem } from "../../app/layout/NavConfig";

interface Page {
  readonly label: string;
  readonly to: string;
}

interface Section {
  readonly key: string;
  readonly labelKey: string;
  readonly icon: string;
  readonly to: string;
  readonly count: number;
  // The first few pages inside, listed on the book's inner page when its cover swings open.
  readonly pages: readonly Page[];
}

// A sticky note on a book: something in that section is waiting for someone. The text is already translated.
export interface TileNote {
  readonly text: string;
  readonly tone: "warn" | "danger" | "info";
}

// Cycles through six token-based accents (never an arbitrary colour) so neighbouring books read as
// distinct sections at a glance.
const ACCENTS = ["a", "b", "c", "d", "e", "f"] as const;

// How many page names fit on the inner page before the rest collapse into a "+N".
const SHOWN_PAGES = 3;

const PIN_KEY = "markaz-pinned-books";

// Pinned books are a per-browser convenience, so storage is wrapped and a failure just means nothing is pinned.
function readPins(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PIN_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writePins(pins: readonly string[]): void {
  try {
    window.localStorage.setItem(PIN_KEY, JSON.stringify(pins));
  } catch {
    // storage blocked: the pins last for this visit only
  }
}

// One ledger book per part of the app this signed-in user may actually open, standing on a shelf: the
// sidebar's own groups, each collapsed into a single book, plus any ungrouped page (today only first-run
// setup). The bookmark ribbon shows how many screens the book holds and a sticky note flags work waiting
// there. Picking a book up swings its cover open to list its first screens, numbered like folios — each one a
// button that opens that screen. A section is shown only when at least one of its pages is permitted, and a
// click on the cover opens the first permitted page in NavConfig's own order — the same list the sidebar is
// built from, so a book can never offer a page the sidebar would hide, and a sales clerk and an accountant
// land somewhere different from the very same book.
export function ModuleTiles({ notes }: { readonly notes: Readonly<Record<string, TileNote>> }): React.JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canAny } = usePermissions();
  const [sound, setSound] = useState(readSoundPreference);
  const [pins, setPins] = useState<string[]>(readPins);

  const togglePin = (key: string): void => {
    const next = pins.includes(key) ? pins.filter((k) => k !== key) : [...pins, key];
    setPins(next);
    writePins(next);
  };

  // A saved "on" can only start making sound after the first click or key press on the page.
  useEffect(() => {
    if (!sound) return undefined;
    const unlock = (): void => void unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [sound]);

  const toggleSound = (): void => {
    const next = !sound;
    setSound(next);
    writeSoundPreference(next);
    // switching it on plays one page turn as a preview, once the recording is ready
    if (next) void unlockAudio().then(playPaper);
  };

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
      return {
        key,
        labelKey: key,
        icon: GROUP_ICONS[key] ?? DEFAULT_GROUP_ICON,
        to: items[0]!.to,
        count: items.length,
        pages: items.slice(0, SHOWN_PAGES).map((item) => ({ label: t(item.labelKey), to: item.to })),
      };
    });
    const standaloneSections: Section[] = standalone.map((item) => ({ key: item.to, labelKey: item.labelKey, icon: item.icon, to: item.to, count: 1, pages: [{ label: t(item.labelKey), to: item.to }] }));
    return [...standaloneSections, ...groupSections];
  }, [canAny, t]);

  // Each book keeps its own colour; pinned ones then move to the front, in the order they were pinned.
  const ordered = useMemo(() => {
    const coloured = sections.map((s, i) => ({ ...s, accent: ACCENTS[i % ACCENTS.length] }));
    const pinned = pins.flatMap((key) => coloured.filter((s) => s.key === key));
    return [...pinned, ...coloured.filter((s) => !pins.includes(s.key))];
  }, [sections, pins]);

  if (sections.length === 0) return null;

  return (
    <section className="erp-card mk-tiles-card">
      <div className="mk-tiles-head">
        <h2 className="erp-card__title">{t("dashboard.sections.title")}</h2>
        <button type="button" className="mk-sound" aria-pressed={sound} title={t("dashboard.sections.sound")} aria-label={t("dashboard.sections.sound")} onClick={toggleSound}>
          <i className={sound ? "pi pi-volume-up" : "pi pi-volume-off"} aria-hidden="true" />
        </button>
      </div>
      <div className="mk-tiles">
        {ordered.map((s, index) => {
          const label = t(s.labelKey);
          const screens = t("dashboard.sections.count", { count: s.count });
          const note = notes[s.key];
          const more = s.count - s.pages.length;
          const pinned = pins.includes(s.key);
          return (
            <div key={s.key} className="mk-slot" style={{ "--i": index } as React.CSSProperties}>
              <div
                className={`mk-tile mk-tile--${s.accent}`}
                role="group"
                aria-label={label}
                onMouseEnter={() => sound && playPaper()}
                onFocus={(e) => {
                  // keyboard focus only: a mouse click also focuses the book, right after hover already played it
                  if (sound && e.target.matches(":focus-visible") && !e.currentTarget.contains(e.relatedTarget)) playPaper();
                }}
              >
                <span className="mk-tile__spine" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>

                <button
                  type="button"
                  className={`mk-tile__pin${pinned ? " is-pinned" : ""}`}
                  aria-pressed={pinned}
                  title={t(pinned ? "dashboard.sections.unpin" : "dashboard.sections.pin", { name: label })}
                  aria-label={t(pinned ? "dashboard.sections.unpin" : "dashboard.sections.pin", { name: label })}
                  onClick={() => togglePin(s.key)}
                >
                  <i className={pinned ? "pi pi-star-fill" : "pi pi-star"} aria-hidden="true" />
                </button>

                <span className="mk-tile__inside">
                  {s.pages.map((page, n) => (
                    <button key={page.to} type="button" className="mk-tile__row" style={{ "--n": n } as React.CSSProperties} onClick={() => void navigate(page.to)}>
                      <b aria-hidden="true">{n + 1}</b>
                      <span>{page.label}</span>
                    </button>
                  ))}
                  {more > 0 ? (
                    <span className="mk-tile__more" aria-hidden="true" style={{ "--n": s.pages.length } as React.CSSProperties}>
                      +{more}
                    </span>
                  ) : null}
                </span>

                {note ? (
                  <span className={`mk-tile__note mk-tile__note--${note.tone}`} title={note.text}>
                    {note.text}
                  </span>
                ) : null}

                <span className="mk-tile__ribbon" title={screens} aria-hidden="true">
                  {s.count}
                </span>

                <button type="button" className="mk-tile__cover" aria-label={`${label}, ${screens}${note ? `, ${note.text}` : ""}`} onClick={() => void navigate(s.to)}>
                  <span className="mk-tile__icon" aria-hidden="true">
                    <i className={s.icon} />
                  </span>
                  <span className="mk-tile__plate" aria-hidden="true">
                    <span className="mk-tile__label">{label}</span>
                  </span>
                  <span className="mk-tile__rules" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
