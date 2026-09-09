// Local print/hardware agent — docs/00-PRODUCT-BRIEF.md §8, ADR-0002.
// EMPTY placeholder in M0. Real implementation starts M3 (docs/14-MILESTONES.md),
// scoped to whatever hardware the first real customer actually needs — not a
// speculative general-purpose driver layer.
//
// Non-negotiable when this is implemented (docs/09-SECURITY-RULES.md §4):
// - binds to 127.0.0.1 ONLY, never 0.0.0.0 or any external interface
// - accepts jobs only from the web app's own origin running on this same machine
// - does not execute arbitrary content it is handed
export const PRINT_AGENT_PLACEHOLDER = true;
