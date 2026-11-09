export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  readonly severity: ValidationSeverity;
  // Stable identifier, safe to assert on in tests and to show in a UI.
  readonly code: string;
  readonly message: string;
}

export interface ValidationReport {
  // True when there is no `error`. Warnings never make a report invalid.
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export function reportOf(issues: readonly ValidationIssue[]): ValidationReport {
  return { valid: !issues.some((i) => i.severity === "error"), issues };
}

export class IssueCollector {
  private readonly issues: ValidationIssue[] = [];

  error(code: string, message: string): void {
    this.issues.push({ severity: "error", code, message });
  }

  warn(code: string, message: string): void {
    this.issues.push({ severity: "warning", code, message });
  }

  report(): ValidationReport {
    return reportOf(this.issues);
  }
}
