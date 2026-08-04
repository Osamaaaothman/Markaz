// @ts-check
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const prettier = require("eslint-config-prettier");

/**
 * Shared base ESLint flat config. Apps extend this array and append their
 * own environment-specific configs (React rules for the desktop app,
 * NestJS-specific rules for the api app).
 */
module.exports = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: ["dist/**", "build/**", ".turbo/**", "node_modules/**", "release/**"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Build tooling config files (eslint.config.js, vite config, etc.) are
    // intentionally CommonJS regardless of the package's module type.
    files: ["**/*.config.{js,cjs,ts}", "**/eslint.config.*"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
