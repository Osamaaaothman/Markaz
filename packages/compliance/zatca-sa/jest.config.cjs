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
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "commonjs" } }],
  },
};
