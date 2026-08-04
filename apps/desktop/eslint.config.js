// @ts-check
const base = require("@erp/config/eslint.base.js");
const globals = require("globals");
const reactHooks = require("eslint-plugin-react-hooks");
const reactRefreshModule = require("eslint-plugin-react-refresh");
const reactRefresh = reactRefreshModule.default ?? reactRefreshModule;

module.exports = [
  ...base,
  {
    ignores: ["out/**"],
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    ...reactRefresh.configs.vite,
  },
];
