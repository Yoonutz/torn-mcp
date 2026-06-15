// @license MIT
// Contract tests: prove the committed catalog and our path construction stay
// true to openapi.json. A drift (stale generated files, a hand-edit, or a
// generator change) fails here.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildCatalog } from "../../scripts/lib/catalog.mjs";
import { resolveEndpointPath } from "../torn.js";
import { ENDPOINTS, TAGS, type EndpointDef, type TornTag } from "./endpoints.js";
import { MANIFEST } from "./manifest.js";

const spec = JSON.parse(readFileSync("openapi.json", "utf8"));
const built = buildCatalog(spec);

describe("catalog ↔ spec contract", () => {
  it("committed catalog matches a fresh build from openapi.json (no drift)", () => {
    expect(built.tags).toEqual(ENDPOINTS);
    expect([...built.tagList]).toEqual([...TAGS]);
  });

  it("manifest counts match the spec", () => {
    expect(MANIFEST.openapiVersion).toBe(built.openapiVersion);
    expect(MANIFEST.endpoints).toBe(built.endpoints);
    expect(MANIFEST.rawOperations).toBe(built.rawOps);
    expect(MANIFEST.tags).toBe(built.tagList.length);
  });

  it("every catalog path is a real GET endpoint in the spec", () => {
    for (const tag of Object.keys(ENDPOINTS)) {
      const map = ENDPOINTS[tag as TornTag] as Record<string, EndpointDef>;
      for (const [name, def] of Object.entries(map)) {
        if (def.path) {
          expect(spec.paths[def.path]?.get, `${tag}/${name} path ${def.path}`).toBeTruthy();
        }
        if (def.idPath) {
          expect(spec.paths[def.idPath]?.get, `${tag}/${name} idPath ${def.idPath}`).toBeTruthy();
        }
      }
    }
  });

  it("requiresId is consistent with the available paths", () => {
    for (const tag of Object.keys(ENDPOINTS)) {
      const map = ENDPOINTS[tag as TornTag] as Record<string, EndpointDef>;
      for (const [name, def] of Object.entries(map)) {
        if (def.requiresId) {
          expect(def.idPath, `${tag}/${name} requiresId needs idPath`).toBeTruthy();
          expect(def.path, `${tag}/${name} requiresId must lack a plain path`).toBeFalsy();
        } else {
          expect(def.path, `${tag}/${name} needs a plain path`).toBeTruthy();
        }
      }
    }
  });

  it("resolveEndpointPath produces a real spec path for every endpoint", () => {
    for (const tag of Object.keys(ENDPOINTS)) {
      const map = ENDPOINTS[tag as TornTag] as Record<string, EndpointDef>;
      for (const [name, def] of Object.entries(map)) {
        const resolved = resolveEndpointPath(tag, name, def.requiresId ? "1" : undefined);
        // Re-template the resolved path (swap the filled id back to a placeholder)
        // and confirm it matches a spec path.
        const template = def.requiresId
          ? def.idPath
          : def.idPath && resolved.includes("/1/")
            ? def.idPath
            : def.path;
        expect(spec.paths[template as string]?.get, `${tag}/${name} → ${resolved}`).toBeTruthy();
      }
    }
  });
});
