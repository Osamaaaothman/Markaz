import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export type Side = "SALES" | "SUPPLIER";

export interface AgingPartyRow {
  readonly partyId: string;
  readonly partyName: string;
  readonly partyNameAr: string | null;
  readonly current: string;
  readonly days1to30: string;
  readonly days31to60: string;
  readonly days61to90: string;
  readonly over90: string;
  readonly onAccount: string;
  readonly total: string;
}

export interface AgingReport {
  readonly side: Side;
  readonly asOf: string;
  readonly parties: readonly AgingPartyRow[];
  readonly totals: Omit<AgingPartyRow, "partyId" | "partyName" | "partyNameAr">;
  readonly ledgerBalance: string | null;
  readonly difference: string | null;
}

export function useAging(side: Side, asOf: string) {
  return useQuery({
    queryKey: ["aging", side, asOf],
    queryFn: async () => (await apiClient.get<AgingReport>("/v1/reports/aging", { params: { side, asOf } })).data,
    enabled: asOf !== "",
    staleTime: 10_000,
  });
}

export interface PartyStatementLine {
  readonly kind: "INVOICE" | "CREDIT_NOTE" | "RECEIPT" | "PAYMENT";
  readonly documentId: string;
  readonly number: string;
  readonly date: string;
  readonly reference: string | null;
  readonly charge: string;
  readonly settlement: string;
  readonly balance: string;
}

export interface PartyStatement {
  readonly side: Side;
  readonly partyId: string;
  readonly partyName: string;
  readonly partyNameAr: string | null;
  readonly from: string;
  readonly to: string;
  readonly openingBalance: string;
  readonly totalCharges: string;
  readonly totalSettlements: string;
  readonly closingBalance: string;
  readonly lines: readonly PartyStatementLine[];
}

export function usePartyStatement(partyId: string, side: Side, from: string, to: string) {
  return useQuery({
    queryKey: ["partyStatement", partyId, side, from, to],
    queryFn: async () => (await apiClient.get<PartyStatement>("/v1/reports/party-statement", { params: { partyId, side, from, to } })).data,
    enabled: partyId !== "" && from !== "" && to !== "",
    staleTime: 10_000,
  });
}
