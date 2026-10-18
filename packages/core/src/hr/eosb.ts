import { Prisma } from "@erp/db";

// End-of-service gratuity, Saudi Labor Law. Sources read directly, not from a summary:
//   - Ministry of Human Resources and Social Development, "Rights at the end of an employment
//     contract" (hrsd.gov.sa/media-center/media/lerightseocontract, published 16 Aug 2023):
//     "the LAST wage is taken as the basis for computing the award" -- half a month's wage per
//     year for the first five years, a full month per year after that, pro-rated for a partial
//     year, reduced on resignation.
//   - The wage base: Osama's decision (18 Oct 2026) is basic salary plus the employee's fixed,
//     regular allowances -- i.e. the whole SalaryStructure, not basic alone. The Ministry's own
//     wording ("the last wage") does not name either of the Labor Law's two defined wage terms
//     (basic vs. actual), so this is the system's own reading of a term the statute leaves open,
//     not a quote from it. REVIEW: whether a commissioned employee's average commission belongs
//     in the base is still open -- this module does not add it.

export type EndOfServiceReason = "RESIGNATION" | "TERMINATION" | "OTHER";

export interface EosbResult {
  readonly yearsOfService: string; // decimal years, e.g. "6.247" -- stored, not recomputed
  readonly grossEntitlement: string;
  readonly entitlementFraction: string; // 0, 1/3, 2/3 or 1
  readonly netEntitlement: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Whole calendar years since the hiring anniversary, plus the fraction of the *current* year
// actually worked (days since the last anniversary, over however many days that specific year
// runs -- 365 or 366, whichever it really is) -- not an average like days/365.25, which drifts a
// fraction of a percent off a real calendar and would misstate a years-long tenure.
function yearsOfServiceBetween(hireDate: Date, terminationDate: Date): Prisma.Decimal {
  const anniversary = (years: number): Date => new Date(Date.UTC(hireDate.getUTCFullYear() + years, hireDate.getUTCMonth(), hireDate.getUTCDate()));

  let years = terminationDate.getUTCFullYear() - hireDate.getUTCFullYear();
  if (anniversary(years).getTime() > terminationDate.getTime()) years -= 1;
  years = Math.max(0, years);

  const lastAnniversary = anniversary(years);
  const nextAnniversary = anniversary(years + 1);
  const daysInCurrentYear = Math.round((nextAnniversary.getTime() - lastAnniversary.getTime()) / MS_PER_DAY);
  const daysSinceAnniversary = Math.max(0, Math.round((terminationDate.getTime() - lastAnniversary.getTime()) / MS_PER_DAY));

  return new Prisma.Decimal(years).plus(new Prisma.Decimal(daysSinceAnniversary).dividedBy(daysInCurrentYear));
}

// Article 85: a resignation keeps nothing before 2 years, a third between 2 and 5, two-thirds
// between 5 and 10, and the full award from 10 years on. Any other reason for leaving --
// employer-initiated termination, death, force majeure (Article 87) -- is paid in full.
function entitlementFraction(reason: EndOfServiceReason, years: Prisma.Decimal): Prisma.Decimal {
  if (reason !== "RESIGNATION") return new Prisma.Decimal(1);
  if (years.lessThan(2)) return new Prisma.Decimal(0);
  if (years.lessThanOrEqualTo(5)) return new Prisma.Decimal(1).dividedBy(3);
  if (years.lessThan(10)) return new Prisma.Decimal(2).dividedBy(3);
  return new Prisma.Decimal(1);
}

export function computeEndOfServiceSettlement(params: {
  readonly wageBase: string; // basic salary + fixed allowances
  readonly hireDate: Date;
  readonly terminationDate: Date;
  readonly reason: EndOfServiceReason;
}): EosbResult {
  const wage = new Prisma.Decimal(params.wageBase);
  const years = yearsOfServiceBetween(params.hireDate, params.terminationDate);

  const firstFiveYears = Prisma.Decimal.min(years, 5);
  const remainingYears = Prisma.Decimal.max(years.minus(5), 0);
  const gross = wage.times("0.5").times(firstFiveYears).plus(wage.times(remainingYears));

  const fraction = entitlementFraction(params.reason, years);
  const net = gross.times(fraction);

  return {
    yearsOfService: years.toFixed(3),
    grossEntitlement: gross.toFixed(4),
    entitlementFraction: fraction.toFixed(4),
    netEntitlement: net.toFixed(4),
  };
}
