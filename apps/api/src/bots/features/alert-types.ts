// Alert types a linked user can mute in the bot settings (docs/BOTS-INTEGRATION-PLAN.md §5.2).
export const ALERT_TYPES = ["approval_requested", "low_stock", "zatca_problem"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
