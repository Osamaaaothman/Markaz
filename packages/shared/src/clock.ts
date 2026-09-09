// Injectable clock — docs/10-TESTING-RULES.md §3: "no wall-clock dependence (inject
// the clock)". Anything that reasons about time (lockouts, license grace periods,
// fiscal period boundaries later) takes a Clock instead of calling `new Date()`
// directly, so tests can control time deterministically.
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
