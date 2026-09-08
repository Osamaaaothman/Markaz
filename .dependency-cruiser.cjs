// Enforces the module boundary rules in docs/02-ARCHITECTURE-RULES.md §1.
// Run: pnpm boundaries

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-cross-module-internals",
      comment:
        "Modules talk through Core or a published index.ts, never another module's internals.",
      severity: "error",
      from: { path: "^packages/modules/([^/]+)/" },
      to: {
        path: "^packages/modules/([^/]+)/(?!index\\.ts$).+",
        pathNot: "^packages/modules/$1/",
      },
    },
    {
      name: "no-core-depends-on-modules",
      comment: "Core must not know its consumers exist.",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: "^packages/modules/" },
    },
    {
      name: "no-module-depends-on-zatca-directly",
      comment: "Modules depend on the compliance contract only, never a country pack.",
      severity: "error",
      from: { path: "^packages/modules/" },
      to: { path: "^packages/compliance/zatca-sa/" },
    },
    {
      name: "no-web-into-backend-internals",
      comment: "Frontend talks HTTP + generated types only.",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: "^(apps/api|packages/core|packages/modules|packages/db)/" },
    },
    {
      name: "no-circular",
      comment: "Circular dependencies make module boundaries meaningless.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require"] },
    exclude: { path: "node_modules" },
  },
};
