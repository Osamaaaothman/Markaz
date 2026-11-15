export interface FeedbackMeta extends Record<string, unknown> {
  readonly feedback?: "dialog" | "silent";
  readonly successKey?: string;
  readonly successSeverity?: "success" | "info";
}

export interface FeedbackMessage {
  readonly severity: "success" | "info" | "warn" | "error";
  readonly key: string;
}

// Bulk operations can resolve successfully while some rows were skipped or failed.
export function successFeedback(data: unknown, meta?: FeedbackMeta): FeedbackMessage | null {
  if (meta?.feedback === "dialog" || meta?.feedback === "silent") return null;
  const result = data !== null && typeof data === "object" ? data as Record<string, unknown> : {};
  if (result.ok === false) return { severity: "error", key: "feedback.failed" };
  const partial = (Array.isArray(result.failed) && result.failed.length > 0)
    || (Array.isArray(data) && data.some((row: unknown) => row !== null && typeof row === "object" && "status" in row && (row.status === "SKIPPED" || row.status === "FAILED")));
  if (partial) return { severity: "warn", key: "feedback.partial" };
  return { severity: meta?.successSeverity ?? "success", key: meta?.successKey ?? "feedback.saved" };
}
