// The five mandatory Core contracts — docs/02-ARCHITECTURE-RULES.md §3.
// Type shapes only in M0. Implementations land in M1 (identity/audit/numbering)
// and M2 (accounting engine), per docs/14-MILESTONES.md. No module may implement
// any of these itself — that is a defect, not a shortcut.

export interface PostingCommand {
  readonly tenantScope: unknown; // replaced with the real company/branch scope type in M2
  readonly sourceModule: string;
  readonly sourceDocumentType: string;
  readonly sourceDocumentId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface PostingResult {
  readonly journalEntryId: string;
}

export interface IAccountingEngine {
  postEntry(command: PostingCommand): Promise<PostingResult>;
  reverseEntry(entryId: string, reason: string, actorId: string): Promise<PostingResult>;
}

export interface IPermissionService {
  can(actorId: string, action: string, resource: string, scope?: string): Promise<boolean>;
}

export interface INumberingService {
  next(documentType: string, context: Record<string, unknown>): Promise<string>;
}

export interface AuditEvent {
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly before?: Record<string, unknown>;
  readonly after?: Record<string, unknown>;
  readonly correlationId: string;
}

export interface IAuditLogger {
  log(event: AuditEvent): Promise<void>;
}

// Contract #5 (unified reporting layer) is not a single interface — it is the rule
// that module data reaches the financial statements only through the ledger
// (docs/02-ARCHITECTURE-RULES.md §3.5). Enforced by review and by the reconciliation
// tests in docs/05-ACCOUNTING-INTEGRITY-RULES.md §7, not by a TypeScript type.
