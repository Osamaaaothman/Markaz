/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  rootDir: "src",
  // Mirrors packages/core/jest.config.cjs — same reasoning, one level deeper on disk.
  testTimeout: 60_000,
  testRegex: ".*\\.spec\\.ts$",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@erp/db$": "<rootDir>/../../../db/src/index.ts",
    "^@erp/shared$": "<rootDir>/../../../shared/src/index.ts",
    // Test-only (fixture convenience: posting a real balanced journal entry so a SalesInvoice
    // row satisfies its FK) — zatca-sa's own src never imports @erp/core.
    "^@erp/core$": "<rootDir>/../../../core/src/index.ts",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "commonjs" } }],
  },
};
