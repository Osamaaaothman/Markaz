import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

// Build step for public/sw.js, with no extra dependency:
//  1. writes /precache-manifest.json: every emitted JS/CSS/font file, so the worker can keep the whole app
//     (lazy page chunks included) and Markaz opens offline;
//  2. stamps the worker with a build id derived from those files, so each deploy changes sw.js and browsers
//     install the new worker (a byte-identical worker would never update).
export function pwaPrecache(): Plugin {
  let config: ResolvedConfig;
  let buildId = "";
  return {
    name: "markaz-pwa-precache",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((name) => /\.(?:js|css|woff2)$/.test(name))
        .sort()
        .map((name) => `/${name}`);
      buildId = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "precache-manifest.json", source: JSON.stringify({ buildId, files }) });
    },
    async closeBundle() {
      const worker = path.resolve(config.root, config.build.outDir, "sw.js");
      try {
        const source = await readFile(worker, "utf8");
        await writeFile(worker, source.replace("__BUILD_ID__", buildId), "utf8");
      } catch {
        /* no sw.js in the output (a custom build): nothing to stamp */
      }
    },
  };
}
