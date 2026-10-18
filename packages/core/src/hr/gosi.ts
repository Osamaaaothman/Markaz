import { Prisma } from "@erp/db";

// Saudi social insurance (GOSI) contributions, read from the primary sources (not a summary, not
// a vendor blog -- docs/06-COMPLIANCE-PACK-RULES.md section 0 applies here just as much as it
// does to ZATCA):
//
//   - Royal Decree M/273, dated 26 Dhu al-Hijjah 1445H, promulgating the new Social Insurance Law.
//     Clause "third" fixes the pensions-branch gradual schedule; clause "second" names the narrow
//     exception that stays on the old law entirely. Read at gosi.gov.sa/ar/SystemsAndRegulations/newSystem,
//     18 Oct 2026.
//   - Article 15 of the Law: the pensions-branch contribution is 22% of the subject wage at
//     steady state, split 11% employer / 11% employee.
//   - Article 29 of the Law: occupational-hazards contribution is a flat 2%, employer only.
//   - Article 44 of the Law: unemployment insurance (SANED) is 2% total, 1% employer / 1% employee,
//     and applies only to Saudi workers.
//   - Article 19 of the Executive Regulation: the contribution base (basic wage + cash housing
//     allowance) is capped at SAR 45,000/month.
//
// REVIEW: the law's clause "second" exempts two narrow categories (an uncompensated prior
// contribution period, or an existing pensioner) from the whole new schedule, keeping them on the
// pre-2024 law. That is a per-employee legal judgement this system cannot make on its own --
// Employee.gosiLegacyTrack is set by hand, and when it is true this module does not compute a
// rate for that employee at all; the caller must get it confirmed by an accountant or GOSI
// itself before relying on a figure for that employee.

export const GOSI_LAW_EFFECTIVE_DATE = new Date(Date.UTC(2024, 6, 2)); // 26 Dhu al-Hijjah 1445H = 2 Jul 2024 (Umm al-Qura)
export const GOSI_CONTRIBUTION_BASE_CAP = "45000.0000";
const OCCUPATIONAL_HAZARDS_RATE = "0.02"; // Article 29 -- employer only
const SANED_EMPLOYEE_RATE = "0.01"; // Article 44 -- Saudis only
const SANED_EMPLOYER_RATE = "0.01"; // Article 44 -- Saudis only

// Royal Decree M/273, clause "third"(1): the pensions-branch total, in 12-month steps from the
// law's effective date, each split 50/50 between employer and employee until it reaches the 22%
// Article 15 sets as the permanent rate.
const PENSION_SCHEDULE: readonly { readonly throughMonth: number; readonly totalRate: string }[] = [
  { throughMonth: 12, totalRate: "0.18" },
  { throughMonth: 24, totalRate: "0.19" },
  { throughMonth: 36, totalRate: "0.20" },
  { throughMonth: 48, totalRate: "0.21" },
  { throughMonth: Infinity, totalRate: "0.22" },
];

export class GosiLegacyTrackError extends Error {
  constructor() {
    super("This employee is on the pre-2024 GOSI law (gosiLegacyTrack) -- no automated rate applies; confirm the figure with an accountant.");
    this.name = "GosiLegacyTrackError";
  }
}

export interface GosiContribution {
  readonly contributionBase: string;
  readonly pensionRateTotal: string; // e.g. "0.20" -- for display/audit, not for recomputation
  readonly employeeShare: string;
  readonly employerShare: string;
}

function monthsBetween(from: Date, to: Date): number {
  const years = to.getUTCFullYear() - from.getUTCFullYear();
  const months = to.getUTCMonth() - from.getUTCMonth();
  let total = years * 12 + months;
  if (to.getUTCDate() < from.getUTCDate()) total -= 1;
  return Math.max(0, total);
}

// The pensions-branch total rate in effect on `asOf`, per the gradual schedule above. Only
// meaningful for an employee on the new law (gosiLegacyTrack === false).
export function pensionRateTotalAsOf(asOf: Date, lawEffectiveDate: Date = GOSI_LAW_EFFECTIVE_DATE): string {
  const monthsElapsed = monthsBetween(lawEffectiveDate, asOf) + 1; // "within the first 12 months" is months 1..12
  const step = PENSION_SCHEDULE.find((s) => monthsElapsed <= s.throughMonth);
  return (step ?? PENSION_SCHEDULE[PENSION_SCHEDULE.length - 1]!).totalRate;
}

// `basicSalary` and `housingAllowance` are the only two wage components GOSI counts (Article 17
// of the Executive Regulation) -- "other allowances" never enter this calculation.
export function computeGosiContribution(params: {
  readonly basicSalary: string;
  readonly housingAllowance: string;
  readonly isSaudi: boolean;
  readonly gosiLegacyTrack: boolean;
  readonly asOf: Date;
}): GosiContribution {
  if (params.gosiLegacyTrack) throw new GosiLegacyTrackError();

  const rawBase = new Prisma.Decimal(params.basicSalary).plus(params.housingAllowance);
  const base = Prisma.Decimal.min(rawBase, GOSI_CONTRIBUTION_BASE_CAP);

  if (!params.isSaudi) {
    // Expatriate: occupational hazards only, employer-borne, no pensions, no SANED.
    return {
      contributionBase: base.toFixed(4),
      pensionRateTotal: "0.00",
      employeeShare: "0.0000",
      employerShare: base.times(OCCUPATIONAL_HAZARDS_RATE).toFixed(4),
    };
  }

  const pensionRateTotal = pensionRateTotalAsOf(params.asOf);
  const pensionSharePerSide = new Prisma.Decimal(pensionRateTotal).dividedBy(2);
  const employeeShare = base.times(pensionSharePerSide).plus(base.times(SANED_EMPLOYEE_RATE));
  const employerShare = base.times(pensionSharePerSide).plus(base.times(OCCUPATIONAL_HAZARDS_RATE)).plus(base.times(SANED_EMPLOYER_RATE));

  return {
    contributionBase: base.toFixed(4),
    pensionRateTotal,
    employeeShare: employeeShare.toFixed(4),
    employerShare: employerShare.toFixed(4),
  };
}
