/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // See the matching comment in packages/core/jest.config.cjs — @erp/* packages
    // publish compiled ESM dist/ output for real runtime use; tests redirect to
    // source so ts-jest's CJS-forced transform can handle them consistently.
    "^@erp/db$": "<rootDir>/../../../packages/db/src/index.ts",
    "^@erp/shared$": "<rootDir>/../../../packages/shared/src/index.ts",
    "^@erp/core$": "<rootDir>/../../../packages/core/src/index.ts",
  },
  // apps/api compiles to CommonJS at build time (tsconfig.json), but ts-jest's
  // default preset doesn't reliably infer that from a plain tsconfig extend chain —
  // forcing it explicitly avoids the same ESM/CJS transform mismatch hit in
  // packages/core.
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "commonjs" } }],
  },
};
