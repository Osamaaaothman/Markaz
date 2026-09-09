/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  // Source imports use explicit ".js" extensions (required by NodeNext module
  // resolution at runtime), but ts-jest resolves against the .ts source files —
  // this strips the extension back off so Jest's resolver finds them.
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  // package.json declares "type": "module" for the package's own runtime build,
  // but ts-jest's default preset assumes CommonJS — forcing it explicitly here
  // avoids Jest trying (and failing) to run raw untransformed ESM syntax.
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "commonjs" } }],
  },
};
