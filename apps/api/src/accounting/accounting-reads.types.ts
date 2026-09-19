export interface AccountSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly type: string;
}

// Unlike AccountSummary (postable leaves only, for the journal entry account
// picker), this includes non-postable group/header accounts and each
// account's parent — everything the chart of accounts tree needs to render
// the hierarchy, not just what a posting line is allowed to target.
export interface ChartOfAccountEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly type: string;
  readonly isPostable: boolean;
  readonly parentId: string | null;
}

export interface FiscalPeriodSummary {
  readonly id: string;
  readonly periodNumber: number;
  readonly startDate: string;
  readonly endDate: string;
}

export interface JournalEntrySummary {
  readonly id: string;
  readonly number: string;
  readonly entryDate: string;
  readonly currency: string;
  readonly sourceDocumentType: string;
  readonly sourceDocumentId: string;
  readonly isReversal: boolean;
  readonly totalDebit: string;
}

export interface JournalEntryListPage {
  readonly data: JournalEntrySummary[];
  readonly pageInfo: {
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
  };
}

export interface JournalEntryLineDetail {
  readonly id: string;
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly debit: string;
  readonly credit: string;
  readonly description: string | null;
}

export interface JournalEntryDetail {
  readonly id: string;
  readonly number: string;
  readonly entryDate: string;
  readonly postingDate: string;
  readonly currency: string;
  readonly exchangeRate: string | null;
  readonly sourceDocumentType: string;
  readonly sourceDocumentId: string;
  readonly isReversal: boolean;
  readonly reversalOfEntryNumber: string | null;
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly lines: readonly JournalEntryLineDetail[];
}
