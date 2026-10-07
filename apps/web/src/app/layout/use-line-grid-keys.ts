import { useEffect } from "react";

// Keyboard entry for document line grids (invoices, receipts, journal entries): Enter moves to the next
// field instead of submitting the form, and Enter in the last field of the last line adds a new line and
// lands in it — so a whole document can be typed without touching the mouse. A grid opts in simply by
// using the .erp-lines container; its "add line" button is marked data-erp-add-line.
export function useLineGridKeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || target.type === "checkbox" || target.type === "radio" || target.type === "submit") return;
      const grid = target.closest<HTMLElement>(".erp-lines");
      if (!grid) return;
      // A dropdown's own filter box handles Enter itself.
      if (target.closest(".p-dropdown-panel, .p-dropdown-filter-container")) return;

      const fields = [...grid.querySelectorAll<HTMLInputElement>("input:not([type=hidden]):not([disabled]):not([readonly])")].filter((el) => el.offsetParent !== null);
      const index = fields.indexOf(target);
      if (index === -1) return;
      e.preventDefault();

      const next = fields[index + 1];
      if (next) {
        next.focus();
        next.select?.();
        return;
      }
      // Last field of the last line: add a line, then focus its first field.
      const scope = grid.closest<HTMLElement>("form, .erp-form, .p-dialog") ?? document.body;
      const add = scope.querySelector<HTMLButtonElement>("[data-erp-add-line]");
      if (!add) return;
      const before = fields.length;
      add.click();
      requestAnimationFrame(() => {
        const after = [...grid.querySelectorAll<HTMLInputElement>("input:not([type=hidden]):not([disabled]):not([readonly])")].filter((el) => el.offsetParent !== null);
        const first = after[before];
        if (first) first.focus();
      });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
