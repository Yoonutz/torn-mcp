// @license MIT
// Generates src/generated/endpoints.ts from openapi.json.
//
// Torn API v2 is path-based: each data type is its own GET operation
// (e.g. /user/bars, /user/{id}/basic, /faction/members). This generator
// fully dereferences the spec ($ref, allOf, oneOf, anyOf) and emits, per tag,
// an authoritative catalog of endpoints with their real summaries, descriptions,
// path id, and accepted query parameters (names, types, enum values, required).
//
// Nothing here is hand-authored from guesswork — it all comes from the spec.
//
// Usage: node scripts/generate-endpoints.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = JSON.parse(readFileSync(join(root, "openapi.json"), "utf8"));

/** Resolve a $ref like "#/components/schemas/Foo" against the root document. */
function resolveRef(ref) {
  const parts = ref.replace(/^#\//, "").split("/");
  let node = spec;
  for (const p of parts) node = node?.[p];
  return node;
}

/** Dereference one level: follow a $ref if present, else return the node. */
function deref(node, seen = new Set()) {
  if (node && node.$ref) {
    if (seen.has(node.$ref)) return {}; // cycle guard
    seen.add(node.$ref);
    return deref(resolveRef(node.$ref), seen);
  }
  return node ?? {};
}

/** Collect all enum values reachable through $ref / oneOf / anyOf / allOf. */
function collectEnum(node, acc = new Set(), seen = new Set()) {
  if (!node) return acc;
  if (node.$ref) {
    if (seen.has(node.$ref)) return acc;
    seen.add(node.$ref);
    return collectEnum(resolveRef(node.$ref), acc, seen);
  }
  if (Array.isArray(node.enum)) node.enum.forEach((e) => acc.add(e));
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(node[key])) node[key].forEach((n) => collectEnum(n, acc, seen));
  }
  if (node.items) collectEnum(node.items, acc, seen);
  return acc;
}

/** Derive a compact human type string for a (possibly composed) schema. */
function typeOf(schema, seen = new Set()) {
  if (!schema) return "string";
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return "string";
    seen.add(schema.$ref);
    return typeOf(resolveRef(schema.$ref), seen);
  }
  if (Array.isArray(schema.enum)) return "enum";
  if (schema.type === "array") return `array<${typeOf(schema.items, seen)}>`;
  for (const key of ["oneOf", "anyOf"]) {
    if (Array.isArray(schema[key])) {
      const types = [...new Set(schema[key].map((s) => typeOf(s, seen)))];
      return types.join("|");
    }
  }
  if (Array.isArray(schema.allOf)) return typeOf(schema.allOf[0], seen);
  return schema.type || "string";
}

/** Normalize an operation parameter (deref the param itself, then describe it). */
function describeParam(rawParam) {
  const p = deref(rawParam);
  const schema = p.schema ?? {};
  const enumVals = [...collectEnum(schema)];
  const out = {
    name: p.name,
    in: p.in,
    required: !!p.required,
    type: typeOf(schema),
    description: (p.description || "").trim() || undefined,
  };
  if (enumVals.length > 0) out.enum = enumVals;
  return out;
}

/** Parameters that are auth keys — supplied via header, never exposed as query. */
function isAuthKeyParam(p) {
  return p.in === "query" && p.name === "key";
}

/** @type {Record<string, Record<string, object>>} */
const tags = {};

for (const rawPath of Object.keys(spec.paths)) {
  const op = spec.paths[rawPath].get;
  if (!op) continue;
  const tag = ((op.tags && op.tags[0]) || "untagged").toLowerCase();

  const segs = rawPath.split("/").filter(Boolean);
  if (segs.length < 2) continue; // skip bare root like /user
  const hasParam = segs.some((s) => s.startsWith("{"));
  const name = [...segs].reverse().find((s) => !s.startsWith("{"));
  if (!name || name === tag) continue;

  const params = (op.parameters || []).map(describeParam);
  const pathParam = params.find((p) => p.in === "path");
  const query = params.filter((p) => p.in === "query" && !isAuthKeyParam(p));

  tags[tag] = tags[tag] || {};
  const entry = tags[tag][name] || {
    requiresId: false,
    summary: (op.summary || "").trim() || undefined,
    description: (op.description || "").trim() || undefined,
    query,
  };
  if (hasParam) {
    entry.idPath = rawPath;
    if (pathParam) {
      entry.idParam = {
        name: pathParam.name,
        description: pathParam.description,
      };
    }
  } else {
    entry.path = rawPath;
    // Prefer the non-id operation's metadata when both variants exist.
    entry.summary = (op.summary || "").trim() || entry.summary;
    entry.description = (op.description || "").trim() || entry.description;
    entry.query = query;
  }
  tags[tag][name] = entry;
}

for (const tag of Object.keys(tags)) {
  for (const name of Object.keys(tags[tag])) {
    const e = tags[tag][name];
    e.requiresId = !e.path && !!e.idPath;
  }
}

const tagList = Object.keys(tags).sort();

const banner =
  "// @license MIT\n" +
  "// AUTO-GENERATED by scripts/generate-endpoints.mjs — do not edit by hand.\n" +
  "// Fully dereferenced from openapi.json ($ref/allOf/oneOf/anyOf resolved).\n" +
  "// Regenerate with: npm run sync-openapi\n";

let out = banner;
out += `
export interface QueryParam {
  name: string;
  in: "query";
  required: boolean;
  type: string;
  enum?: string[];
  description?: string;
}

export interface EndpointDef {
  /** Path without an id (when the endpoint supports it). */
  path?: string;
  /** Path template containing a single {param} placeholder. */
  idPath?: string;
  /** The path parameter, when this endpoint is id-scoped. */
  idParam?: { name: string; description?: string };
  /** True when the endpoint can only be called with an id. */
  requiresId: boolean;
  /** Operation summary from the spec. */
  summary?: string;
  /** Operation description from the spec. */
  description?: string;
  /** Accepted query parameters (auth key excluded). */
  query: QueryParam[];
}
`;
out += `\nexport const ENDPOINTS = ${JSON.stringify(tags, null, 2)} as const satisfies Record<string, Record<string, EndpointDef>>;\n`;
out += `\nexport type TornTag = keyof typeof ENDPOINTS;\n`;
out += `\nexport const TAGS = ${JSON.stringify(tagList)} as const;\n`;

const genDir = join(root, "src", "generated");
mkdirSync(genDir, { recursive: true });
writeFileSync(join(genDir, "endpoints.ts"), out);

const total = tagList.reduce((n, t) => n + Object.keys(tags[t]).length, 0);
console.log(`Generated ${total} endpoints across ${tagList.length} tags:`);
for (const t of tagList) console.log(`  ${t}: ${Object.keys(tags[t]).length}`);
