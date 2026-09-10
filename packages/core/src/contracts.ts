// The five mandatory Core contracts — docs/02-ARCHITECTURE-RULES.md §3.
// IPermissionService and IAuditLogger implemented M1; IAccountingEngine and
// INumberingService implemented M2 (docs/14-MILESTONES.md). No module may
// implement any of these itself — that is a defect, not a shortcut.

// A module supplies explicit lines (account + debit/credit), not "business terms" —
// docs/02-ARCHITECTURE-RULES.md §3.1 describes a business-terms-to-account-mapping
// layer, but no module exists yet to show what that should actually look like.
// Building it speculatively now, before a real caller exists, would be exactly the
// kind of premature abstraction CLAUDE.md §7 warns against — it gets added on top of
// this same engine once M4 (the first real caller) needs it, informed by a concrete
// example instead of a guess.
export interface JournalLineInput {
  readonly accountId: string;
  readonly debit?: string; // decimal string; exactly one of debit/credit is set
  readonly credit?: string;
  readonly description?: string;
}

export interface PostingCommand {
  readonly companyId: string;
  readonly fiscalPeriodId: string;
  readonly entryDate: Date;
  readonly postingDate: Date;
  readonly currency: string;
  readonly exchangeRate?: string; // to company base currency; omit when currency == base
  readonly lines: readonly JournalLineInput[];
  readonly sourceModule: string;
  readonly sourceDocumentType: string;
  readonly sourceDocumentId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface PostingResult {
  readonly journalEntryId: string;
  readonly number: string;
}

export interface IAccountingEngine {
  postEntry(command: PostingCommand): Promise<PostingResult>;
  reverseEntry(
    entryId: string,
    reason: string,
    actorId: string,
    correlationId: string,
  ): Promise<PostingResult>;
}

export interface IPermissionService {
  can(actorId: string, action: string, resource: string, scope?: string): Promise<boolean>;
}

export interface NumberingContext {
  readonly companyId: string;
  readonly fiscalYear: string;
}

export interface INumberingService {
  // Takes the caller's transaction client explicitly (docs/02-ARCHITECTURE-RULES.md
  // §3.3: "Allocation happens inside the document's transaction... pass the
  // transaction client down explicitly") — never an ambient/implicit transaction.
  next(documentType: string, context: NumberingContext, tx: TransactionClient): Promise<string>;
}

// The subset of PrismaClient usable inside an interactive transaction — narrower
// than the full client (no $transaction, $connect, etc.), matching what Prisma's
// own transaction callback provides.
export type TransactionClient = Omit<
  import("@erp/db").PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

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
