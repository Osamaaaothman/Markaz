// Nest 12 is ESM; controller metadata tests run in Jest's ESM runtime.
const base = require("./jest.config.cjs");
module.exports = {
  ...base,
  testRegex: "cost-centers\\.esm-test\\.ts$",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: { module: "esnext", moduleResolution: "node" } }],
  },
};
