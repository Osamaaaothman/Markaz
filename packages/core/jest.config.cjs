/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  rootDir: "src",
  // The database specs build a whole company (accounts, parties, documents) in beforeAll. Alone that takes
  // a second or two; with every package testing in parallel against one Postgres it can pass 5s, and the
  // default 5s hook timeout turned that load into a spurious failure of a whole spec.
  testTimeout: 60_000,
  testRegex: ".*\\.spec\\.ts$",
  moduleNameMapper: {
    // Source imports use explicit ".js" extensions (required by NodeNext module
    // resolution at runtime), but ts-jest resolves against the .ts source files —
    // this strips the extension back off so Jest's resolver finds them.
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // @erp/db and @erp/shared now publish "main" pointing at their own compiled
    // dist/ (needed for the real production build — see the M2 changelog entry on
    // why). That's real ESM output, which this CJS-forced ts-jest transform can't
    // require() directly. Redirect straight to source for tests instead, so
    // ts-jest transforms them the same consistent way as everything else.
    "^@erp/db$": "<rootDir>/../../db/src/index.ts",
    "^@erp/shared$": "<rootDir>/../../shared/src/index.ts",
  },
  // package.json declares "type": "module" for the package's own runtime build,
  // but ts-jest's default preset assumes CommonJS — forcing it explicitly here
  // avoids Jest trying (and failing) to run raw untransformed ESM syntax.
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "commonjs" } }],
  },
};
