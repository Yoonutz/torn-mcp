// @license MIT
// Download the latest Torn OpenAPI spec, report whether it changed, and
// regenerate src/generated/endpoints.ts.
//
// Usage: node scripts/sync-openapi.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = join(root, "openapi.json");
const SPEC_URL = "https://www.torn.com/swagger/openapi.json";

const prevHash = existsSync(specPath)
  ? createHash("sha256").update(readFileSync(specPath)).digest("hex")
  : null;

console.log(`Downloading ${SPEC_URL} …`);
const res = await fetch(SPEC_URL);
if (!res.ok) {
  console.error(`Failed to download spec: HTTP ${res.status}`);
  process.exit(1);
}
const spec = await res.text();
const nextHash = createHash("sha256").update(spec).digest("hex");

if (prevHash === nextHash) {
  console.log("Spec unchanged — regenerating anyway to be safe.");
} else {
  console.log(
    prevHash ? "Spec changed since last sync." : "No previous spec — first sync.",
  );
}
writeFileSync(specPath, spec);

execFileSync("node", [join(root, "scripts", "generate-endpoints.mjs")], {
  stdio: "inherit",
});
console.log("Done. Review the diff in src/generated/endpoints.ts.");
