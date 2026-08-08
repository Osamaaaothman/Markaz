// @ts-check
const base = require("@erp/config/eslint.base.js");
const globals = require("globals");

module.exports = [
  ...base,
  {
    ignores: ["generated/**"],
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
];
