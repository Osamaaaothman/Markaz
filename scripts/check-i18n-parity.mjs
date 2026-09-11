#!/usr/bin/env node
// docs/10-TESTING-RULES.md §2.6: "Locale key parity: every key exists in both ar
// and en — CI fails otherwise." Walks apps/web/src/locales/{en,ar}, flattens every
// namespace JSON file to dotted keys, and fails with the exact missing keys the
// moment the two locales diverge — never a silent runtime fallback
// (docs/08-FRONTEND-I18N-RULES.md §3).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const localesRoot = join(repoRoot, "apps", "web", "src", "locales");
const LANGUAGES = ["ar", "en"];

function listJsonFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listJsonFiles(full));
    } else if (entry.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}

function flattenKeys(value, prefix = "") {
  const keys = [];
  for (const [key, val] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      keys.push(...flattenKeys(val, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function loadNamespaceKeys(lang) {
  const langDir = join(localesRoot, lang);
  const namespaces = new Map();
  for (const file of listJsonFiles(langDir)) {
    const namespace = relative(langDir, file).replace(/\.json$/, "").split(sep).join("/");
    const content = JSON.parse(readFileSync(file, "utf8"));
    namespaces.set(namespace, new Set(flattenKeys(content)));
  }
  return namespaces;
}

const perLanguage = new Map(LANGUAGES.map((lang) => [lang, loadNamespaceKeys(lang)]));
const allNamespaces = new Set(LANGUAGES.flatMap((lang) => [...perLanguage.get(lang).keys()]));

let hasMismatch = false;

for (const namespace of allNamespaces) {
  const entries = LANGUAGES.map((lang) => ({ lang, keys: perLanguage.get(lang).get(namespace) }));

  for (const entry of entries) {
    if (entry.keys === undefined) {
      hasMismatch = true;
      console.error(`Namespace "${namespace}" is missing entirely for locale "${entry.lang}".`);
    }
  }

  const present = entries.filter((entry) => entry.keys !== undefined);
  for (let i = 0; i < present.length; i += 1) {
    for (let j = i + 1; j < present.length; j += 1) {
      const a = present[i];
      const b = present[j];
      for (const key of a.keys) {
        if (!b.keys.has(key)) {
          hasMismatch = true;
          console.error(`"${namespace}.${key}" exists in "${a.lang}" but is missing in "${b.lang}".`);
        }
      }
      for (const key of b.keys) {
        if (!a.keys.has(key)) {
          hasMismatch = true;
          console.error(`"${namespace}.${key}" exists in "${b.lang}" but is missing in "${a.lang}".`);
        }
      }
    }
  }
}

if (hasMismatch) {
  console.error("\ni18n locale key parity check FAILED — see docs/08-FRONTEND-I18N-RULES.md §3.");
  process.exit(1);
}

console.log(`i18n locale key parity OK — ${allNamespaces.size} namespace(s), locales: ${LANGUAGES.join(", ")}.`);
