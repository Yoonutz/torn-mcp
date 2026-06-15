// @license MIT
// Generates src/generated/endpoints.ts + src/generated/manifest.ts from
// openapi.json. All catalog logic lives in scripts/lib/catalog.mjs.
//
// Usage: node scripts/generate-endpoints.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildCatalog,
  specHashOf,
  renderEndpointsTs,
  renderManifestTs,
} from "./lib/catalog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specText = readFileSync(join(root, "openapi.json"), "utf8");
const catalog = buildCatalog(JSON.parse(specText));
const hash = specHashOf(specText);

const genDir = join(root, "src", "generated");
mkdirSync(genDir, { recursive: true });
writeFileSync(join(genDir, "endpoints.ts"), renderEndpointsTs(catalog));
writeFileSync(join(genDir, "manifest.ts"), renderManifestTs(catalog, hash));

console.log(
  `Generated ${catalog.endpoints} endpoints across ${catalog.tagList.length} tags ` +
    `(OpenAPI ${catalog.openapiVersion}):`,
);
for (const t of catalog.tagList) console.log(`  ${t}: ${Object.keys(catalog.tags[t]).length}`);
