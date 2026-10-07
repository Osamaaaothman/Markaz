// Verifies the Cloudinary attachment storage against the REAL account in .env, end to end:
//   - uploads a small PDF as a private (authenticated) file and reads it back through the same signed path the API uses;
//   - checks the bytes are identical;
//   - checks the private file is NOT reachable without a signature;
//   - uploads and reads a public image (item picture rule);
//   - removes everything it created.
// Run from the repo root after `npm run build -w packages/core`:
//   node --env-file=.env packages/core/scripts/check-cloudinary.mjs
// Nothing secret is printed.
import { createHash, randomUUID } from "node:crypto";
import { CloudinaryFileStorage, newStorageKey, signCloudinaryParams } from "../dist/index.js";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;
const folder = `${process.env.CLOUDINARY_FOLDER || "markaz"}-check`;
if (!cloudName || !apiKey || !apiSecret) {
  console.error("CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must be set in .env");
  process.exit(1);
}

const storage = new CloudinaryFileStorage({ cloudName, apiKey, apiSecret, folder });
let failed = false;
const report = (name, ok, extra = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n% markaz cloudinary check\n"), Buffer.alloc(3000, 5)]);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const privateKey = newStorageKey(randomUUID());
const publicKey = newStorageKey(randomUUID());
const created = [];

async function destroy(key, extension, type) {
  const publicId = `${folder}/${key}.${extension}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const form = new FormData();
  form.set("api_key", apiKey);
  form.set("timestamp", String(timestamp));
  form.set("public_id", publicId);
  form.set("type", type);
  form.set("signature", signCloudinaryParams({ public_id: publicId, timestamp, type }, apiSecret));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/destroy`, { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  return `${response.status} ${body.result ?? body.error?.message ?? ""}`.trim();
}

try {
  // 1. private PDF round trip
  try {
    await storage.put({ key: privateKey, bytes: pdf, contentType: "application/pdf", visibility: "PRIVATE" });
    created.push([privateKey, "pdf", "authenticated"]);
    report("private upload", true);
    const back = Buffer.from(await storage.get(privateKey, "PRIVATE"));
    report("private download through the signed path", back.equals(pdf), `${back.length} bytes`);
    report("same SHA-256", createHash("sha256").update(back).digest("hex") === createHash("sha256").update(pdf).digest("hex"));
  } catch (error) {
    report("private round trip", false, String(error.message ?? error));
  }

  // 2. the private file must not be public
  const bare = await fetch(`https://res.cloudinary.com/${cloudName}/raw/authenticated/${folder}/${privateKey}.pdf`);
  report("private file is refused without a signature", bare.status === 401 || bare.status === 403 || bare.status === 404, `HTTP ${bare.status}`);
  const asPublic = await fetch(`https://res.cloudinary.com/${cloudName}/raw/upload/${folder}/${privateKey}.pdf`);
  report("private file is not reachable as a public upload", asPublic.status !== 200, `HTTP ${asPublic.status}`);

  // 3. public picture
  try {
    const stored = await storage.put({ key: publicKey, bytes: png, contentType: "image/png", visibility: "PUBLIC" });
    created.push([publicKey, "png", "upload"]);
    report("public upload returns a permanent URL", Boolean(stored.publicUrl), stored.publicUrl ? "(url returned)" : "");
    const back = Buffer.from(await storage.get(publicKey, "PUBLIC"));
    report("public download", back.equals(png), `${back.length} bytes`);
  } catch (error) {
    report("public round trip", false, String(error.message ?? error));
  }
} finally {
  for (const [key, extension, type] of created) console.log(`cleanup ${type}/${extension}: ${await destroy(key, extension, type)}`);
}

console.log(failed ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
