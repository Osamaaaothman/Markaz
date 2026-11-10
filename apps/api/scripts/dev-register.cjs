"use strict";

// Local dev only. Registers ts-node (CJS, transpile-only) and adds a narrow
// fallback: when a require() for a path inside this app's own src/ fails
// because it ends in ".js" (the NodeNext-style specifier our source uses),
// retry it as ".ts". Scoped to our own src/ tree only, so it never touches
// node_modules resolution (e.g. @prisma/client's generated CJS, which breaks
// if ts-node's global --experimentalResolver intercepts it).

const path = require("path");
const Module = require("module");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const SRC_ROOT = path.resolve(__dirname, "..", "src") + path.sep;
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options);
  } catch (err) {
    const parentFilename = parent && typeof parent.filename === "string" ? parent.filename : "";
    if (request.endsWith(".js") && parentFilename.startsWith(SRC_ROOT)) {
      const tsRequest = request.slice(0, -3) + ".ts";
      return originalResolveFilename.call(this, tsRequest, parent, isMain, options);
    }
    throw err;
  }
};
