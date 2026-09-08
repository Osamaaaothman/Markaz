// Enforces the commit format in docs/11-GIT-WORKFLOW.md §3.
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "refactor", "test", "docs", "chore", "perf", "db", "i18n", "style"],
    ],
    "scope-enum": [
      2,
      "always",
      [
        "core",
        "inventory",
        "purchasing",
        "sales",
        "compliance",
        "identity",
        "licensing",
        "print-agent",
        "web",
        "shared",
        "infra",
        "ci",
      ],
    ],
    "subject-case": [0],
  },
};
