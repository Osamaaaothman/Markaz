// Shared by anything that interpolates a translated/caller-supplied string into
// HTML (email bodies, PDF documents) — escape unconditionally, even though the
// values originate from our own i18next output, because the interpolated
// parameters within them (a name, a message) are caller-supplied.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
