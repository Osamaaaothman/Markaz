import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { outstandingAdvanceTotal } from "./salary-advance-balance.js";
import { allocateDocumentNumber } from "../reference.js";
import { type EndOfServiceReason, computeEndOfServiceSettlement } from "./eosb.js";

export class EndOfServiceError extends Error {
  constructor(
    readonly code: "EMPLOYEE_NOT_FOUND" | "ALREADY_TERMINATED" | "TERMINATION_BEFORE_HIRE" | "NO_OPEN_PERIOD" | "OUTSTANDING_ADVANCES",
    message: string,
  ) {
    super(message);
    this.name = "EndOfServiceError";
  }
}

export interface EndOfServiceActor {
  readonly id: string;
  readonly companyId: string;
}

export interface SettleEndOfServiceInput {
  readonly employeeId: string;
  readonly terminationDate: Date;
  readonly reason: EndOfServiceReason;
}

export interface EndOfServiceResult {
  readonly id: string;
  readonly number: string;
  // Null when nothing was owed: the settlement is recorded but no accrual entry is posted.
  readonly journalEntryId: string | null;
  readonly yearsOfService: string;
  readonly grossEntitlement: string;
  readonly entitlementFraction: string;
  readonly netEntitlement: string;
}

// Settles an employee's exit: computes the gratuity (packages/core/src/hr/eosb.ts), accrues it
// -- Dr End-of-Service Expense, Cr End-of-Service Payable; nothing is posted when nothing is owed --
// and marks the employee terminated, all in one transaction. Paying the accrued amount out is a separate step (a payment against
// the EOSB-payable account, through the existing payments module), deliberately not folded in
// here: the accrual and the cash payment are two different events that can happen on different
// days, and conflating them would make the ledger lie about when either one actually occurred.
export class EndOfServiceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly accountMappings: AccountMappingService,
    private readonly audit: IAuditLogger,
  ) {}

  async settle(input: SettleEndOfServiceInput, actor: EndOfServiceActor, correlationId: string, idempotencyKey: string): Promise<EndOfServiceResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({ where: { id: input.employeeId, companyId: actor.companyId }, include: { allowances: { include: { allowanceType: true } } } });
      if (!employee) throw new EndOfServiceError("EMPLOYEE_NOT_FOUND", "Employee not found");
      if (!employee.isActive || employee.terminationDate) throw new EndOfServiceError("ALREADY_TERMINATED", "This employee has already been settled");
      if (input.terminationDate.getTime() < employee.hireDate.getTime()) {
        throw new EndOfServiceError("TERMINATION_BEFORE_HIRE", "The termination date is before the hire date");
      }

      // An employee who still owes a salary advance cannot be settled: once the employee is inactive, payroll no longer
      // recovers the advance and the receivable would stay on the books for good. The advance is repaid first.
      // REVIEW: netting the balance against the gratuity is a different design (and a legal question); not built.
      const owed = await outstandingAdvanceTotal(tx, actor.companyId, employee.id);
      if (owed.greaterThan(0)) {
        throw new EndOfServiceError("OUTSTANDING_ADVANCES", `This employee still owes ${owed.toFixed(4)} on salary advances; repay them first`);
      }

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.terminationDate);
      if (!period) throw new EndOfServiceError("NO_OPEN_PERIOD", "No open fiscal period covers the termination date");
      const currency = await companyCurrency(tx, actor.companyId);

      // Wage base: basic salary + fixed allowances -- Osama's decision (18 Oct 2026), reading
      // the Ministry's "last wage" against the two wage terms the Labor Law defines.
      const wageBase = employee.allowances.reduce((sum, a) => (a.allowanceType.inEosbBase ? sum.plus(a.amount) : sum), employee.basicSalary);
      const settlement = computeEndOfServiceSettlement({
        wageBase: wageBase.toFixed(4),
        hireDate: employee.hireDate,
        terminationDate: input.terminationDate,
        reason: input.reason,
      });
      const netEntitlement = new Prisma.Decimal(settlement.netEntitlement);

      const eosbExpenseAccount = await this.accountMappings.resolve(tx, actor.companyId, "EOSB_EXPENSE");
      // The employee's own end-of-service account if they have one, else the company-wide one.
      const eosbPayableAccount = employee.eosbAccountId ?? (await this.accountMappings.resolve(tx, actor.companyId, "EOSB_PAYABLE"));

      const settlementId = newId();
      // Nothing owed (e.g. a resignation under two years) is not a ledger event: the settlement is still recorded
      // -- it is the system of record for the computation and ends the employment -- but no journal entry is posted.
      // The posting engine rejects zero-amount lines, and the database allows a missing entry only when
      // net_entitlement = 0 (end_of_service_settlements_journal_entry_check).
      let journalEntryId: string | null = null;
      if (netEntitlement.greaterThan(0)) {
        const journalLines: JournalLineInput[] = [
          { accountId: eosbExpenseAccount, debit: netEntitlement.toFixed(4), description: `End-of-service accrual -- ${employee.name}` },
          { accountId: eosbPayableAccount, credit: netEntitlement.toFixed(4), description: `End-of-service accrual -- ${employee.name}` },
        ];
        const posting = await this.engine.postEntry(
          {
            companyId: actor.companyId,
            fiscalPeriodId: period.id,
            entryDate: input.terminationDate,
            postingDate: input.terminationDate,
            currency,
            lines: journalLines,
            sourceModule: "hr",
            sourceDocumentType: "end_of_service_settlement",
            sourceDocumentId: settlementId,
            actorId: actor.id,
            correlationId,
            idempotencyKey,
          },
          tx,
        );
        journalEntryId = posting.journalEntryId;
      }

      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.terminationDate);
      const number = await allocateDocumentNumber(tx, actor.companyId, "eosb_settlement_no", "EOS", fiscalYear);

      await tx.endOfServiceSettlement.create({
        data: {
          id: settlementId,
          companyId: actor.companyId,
          employeeId: input.employeeId,
          number,
          terminationDate: input.terminationDate,
          reason: input.reason,
          yearsOfService: settlement.yearsOfService,
          grossEntitlement: settlement.grossEntitlement,
          entitlementFraction: settlement.entitlementFraction,
          netEntitlement,
          payableAccountId: eosbPayableAccount,
          journalEntryId,
          actorId: actor.id,
          correlationId,
        },
      });
      await tx.employee.update({ where: { id: input.employeeId }, data: { terminationDate: input.terminationDate, isActive: false, updatedBy: actor.id, version: { increment: 1 } } });

      return { id: settlementId, number, journalEntryId, ...settlement };
    });

    await this.audit.log({ actorId: actor.id, action: "end_of_service.settled", entityType: "EndOfServiceSettlement", entityId: result.id, after: result, correlationId });
    return result;
  }
}
