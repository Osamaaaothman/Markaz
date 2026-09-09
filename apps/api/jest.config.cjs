/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  // apps/api compiles to CommonJS at build time (tsconfig.json), but ts-jest's
  // default preset doesn't reliably infer that from a plain tsconfig extend chain —
  // forcing it explicitly avoids the same ESM/CJS transform mismatch hit in
  // packages/core.
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "commonjs" } }],
  },
};
