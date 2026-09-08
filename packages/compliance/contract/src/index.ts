// Country-agnostic compliance contract — docs/06-COMPLIANCE-PACK-RULES.md §2.
// No country-specific logic here, ever. "ZATCA" must never appear in this file.
// Implemented starting M7 (docs/14-MILESTONES.md) — this is the type shape only.

export type ComplianceOutcome =
  | { readonly kind: "CLEARED" }
  | { readonly kind: "REPORTED" }
  | { readonly kind: "ACCEPTED_WITH_WARNINGS"; readonly warnings: readonly string[] }
  | { readonly kind: "REJECTED"; readonly reason: string }
  | { readonly kind: "PENDING_RETRY" }
  | { readonly kind: "PACK_UNAVAILABLE" };

export interface ComplianceStatus {
  readonly documentId: string;
  readonly outcome: ComplianceOutcome;
  readonly updatedAt: string;
}

export interface ComplianceArtifacts {
  readonly xml: string;
  readonly qr: string;
  readonly pdfAttachments: readonly Uint8Array[];
}

export interface ICompliancePack {
  onboardTenant(config: Record<string, unknown>): Promise<{ readonly success: boolean }>;
  validateBeforeIssue(invoice: unknown): Promise<{ readonly valid: boolean; readonly errors: readonly string[] }>;
  process(invoice: unknown): Promise<ComplianceOutcome>;
  getStatus(documentId: string): Promise<ComplianceStatus>;
  renderArtifacts(documentId: string): Promise<ComplianceArtifacts>;
}
