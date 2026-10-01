import { isFinalAttempt } from "./job-conventions.js";

describe("isFinalAttempt", () => {
  it("is false while attempts remain", () => {
    expect(isFinalAttempt(1, 5)).toBe(false);
    expect(isFinalAttempt(4, 5)).toBe(false);
  });

  it("is true once attemptsMade reaches the configured ceiling", () => {
    expect(isFinalAttempt(5, 5)).toBe(true);
  });

  it("is true if attemptsMade somehow exceeds the ceiling", () => {
    expect(isFinalAttempt(6, 5)).toBe(true);
  });

  it("falls back to the default job options ceiling when attempts is undefined", () => {
    expect(isFinalAttempt(5, undefined)).toBe(true);
    expect(isFinalAttempt(1, undefined)).toBe(false);
  });
});
