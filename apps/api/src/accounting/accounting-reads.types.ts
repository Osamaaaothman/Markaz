export interface AccountSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
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
