// @license MIT
// Download the latest Torn OpenAPI spec, diff it against the one in the repo,
// regenerate src/generated/{endpoints,manifest}.ts, and report what changed.
//
// Outputs (when run in CI):
//  - the change report to $GITHUB_STEP_SUMMARY (shown on the run page)
//  - a commit message to .sync-msg.txt (gitignored; used by the workflow)
//  - an appended entry in docs/generated/openapi-changelog.md (on change)
//
// Usage: node scripts/sync-openapi.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildCatalog,
  specHashOf,
  renderEndpointsTs,
  renderManifestTs,
  diffCatalogs,
  renderReport,
} from "./lib/catalog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = join(root, "openapi.json");
const SPEC_URL = "https://www.torn.com/swagger/openapi.json";

const EMPTY = { tags: {}, tagList: [], openapiVersion: "none", endpoints: 0 };
const oldCat = existsSync(specPath) ? buildCatalog(JSON.parse(readFileSync(specPath, "utf8"))) : EMPTY;

console.log(`Current OpenAPI version in project: ${oldCat.openapiVersion}`);
console.log(`Downloading ${SPEC_URL} …`);
const res = await fetch(SPEC_URL);
if (!res.ok) {
  console.error(`Failed to download spec: HTTP ${res.status}`);
  process.exit(1);
}
const newText = await res.text();
const newCat = buildCatalog(JSON.parse(newText));
const hash = specHashOf(newText);
const diff = diffCatalogs(oldCat, newCat);
const report = renderReport(diff);

console.log("\n" + report + "\n");

// Always rewrite the snapshot + generated files (deterministic — a no-op when
// the spec is unchanged, so git stays clean unless something actually changed).
writeFileSync(specPath, newText);
const genDir = join(root, "src", "generated");
mkdirSync(genDir, { recursive: true });
writeFileSync(join(genDir, "endpoints.ts"), renderEndpointsTs(newCat));
writeFileSync(join(genDir, "manifest.ts"), renderManifestTs(newCat, hash));

if (diff.hasChanges) {
  // Prepend a dated entry to the committed changelog.
  const date = new Date().toISOString().slice(0, 10);
  const changelogPath = join(root, "docs", "generated", "openapi-changelog.md");
  mkdirSync(dirname(changelogPath), { recursive: true });
  const header = "# Torn OpenAPI change log\n\n";
  const prior = existsSync(changelogPath)
    ? readFileSync(changelogPath, "utf8").replace(header, "")
    : "";
  const entry = `## ${date} — OpenAPI ${newCat.openapiVersion}\n\n${report}\n\n`;
  writeFileSync(changelogPath, header + entry + prior);

  // Commit message for the workflow (gitignored file).
  const subject = diff.versionChanged
    ? `chore(sync): Torn OpenAPI ${diff.oldVersion} → ${diff.newVersion}`
    : `chore(sync): Torn OpenAPI catalog update (${newCat.openapiVersion})`;
  writeFileSync(join(root, ".sync-msg.txt"), `${subject}\n\n${report}\n`);
}

// CI: surface the report on the run page.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Torn OpenAPI sync\n\n${report}\n`);
}

console.log(diff.hasChanges ? "Spec changed — files regenerated." : "Spec unchanged.");
