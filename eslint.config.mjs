// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "**/coverage/**"],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md §1: TypeScript strict, no `any`.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": "allow-with-description", minimumDescriptionLength: 10 },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/packages/modules/*/src/**", "!**/packages/modules/*/src/index"],
              message:
                "Import another module's published index.ts only — never its internals (docs/02-ARCHITECTURE-RULES.md).",
            },
            {
              group: ["**/compliance/zatca-sa/**"],
              message:
                "Modules depend on compliance/contract only, never a country pack directly (docs/06-COMPLIANCE-PACK-RULES.md §1).",
            },
          ],
        },
      ],
    },
  },
);
