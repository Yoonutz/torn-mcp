// @license MIT
// Shared OpenAPI → endpoint-catalog logic, used by generate-endpoints.mjs
// (writes the generated files) and sync-openapi.mjs (diffs old vs new).
//
// Torn API v2 is path-based: each data type is its own GET operation. We fully
// dereference the spec ($ref / allOf / oneOf / anyOf) and build, per tag, an
// authoritative catalog of endpoints with summaries, path id, and query params.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RETURNS_OVERRIDES } from "./returns-overrides.mjs";

// Auto-derived overrides, emitted by the live conformance run when an endpoint's
// real response structurally diverges from the spec. Optional — empty until the
// conformance harness has written it. Manual overrides take precedence.
let GENERATED_OVERRIDES = {};
try {
  const p = join(dirname(fileURLToPath(import.meta.url)), "returns-overrides.generated.json");
  GENERATED_OVERRIDES = JSON.parse(readFileSync(p, "utf8"));
} catch {
  /* none yet */
}

function makeResolver(spec) {
  const resolveRef = (ref) => {
    const parts = ref.replace(/^#\//, "").split("/");
    let node = spec;
    for (const p of parts) node = node?.[p];
    return node;
  };
  const deref = (node, seen = new Set()) => {
    if (node && node.$ref) {
      if (seen.has(node.$ref)) return {};
      seen.add(node.$ref);
      return deref(resolveRef(node.$ref), seen);
    }
    return node ?? {};
  };
  const collectEnum = (node, acc = new Set(), seen = new Set()) => {
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
  };
  const typeOf = (schema, seen = new Set()) => {
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
        return [...new Set(schema[key].map((s) => typeOf(s, seen)))].join("|");
      }
    }
    if (Array.isArray(schema.allOf)) return typeOf(schema.allOf[0], seen);
    return schema.type || "string";
  };
  const describeParam = (rawParam) => {
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
  };

  // Merge an allOf chain into a single object schema (union of properties), so
  // composed response envelopes expose their fields. Non-allOf passes through.
  const flattenAllOf = (schema) => {
    const s = deref(schema);
    if (!Array.isArray(s.allOf)) return s;
    const props = {};
    for (const part of s.allOf) Object.assign(props, flattenAllOf(part).properties || {});
    return { type: "object", properties: props };
  };

  // Coarse response-field type for discovery: array / object / oneOf|anyOf / scalar.
  const respType = (schema) => {
    const s = deref(schema);
    if (s.type === "array") return "array";
    if (Array.isArray(s.allOf)) return "object";
    if (Array.isArray(s.oneOf)) return "oneOf";
    if (Array.isArray(s.anyOf)) return "anyOf";
    return s.type || "object";
  };

  // One level of nested field names: array-item props, or object props.
  const nestedFields = (schema) => {
    const s = deref(schema);
    const target = s.type === "array" ? flattenAllOf(s.items) : flattenAllOf(s);
    return target.properties ? Object.keys(target.properties) : [];
  };

  // Top-level response shape of an operation's 200 body. Returns either
  // { selectionBased: true } when the body is a oneOf/anyOf union (the shape
  // varies by `selections`), or { returns: [{name,type,fields?}] } with the
  // envelope keys (minus pagination `_metadata`) and one level of nested fields.
  const describeReturns = (op) => {
    const r = deref(op.responses?.["200"]);
    const sch = flattenAllOf(r.content?.["application/json"]?.schema);
    if (Array.isArray(sch.oneOf) || Array.isArray(sch.anyOf)) return { selectionBased: true };
    if (!sch.properties) return {};
    const returns = [];
    for (const [name, raw] of Object.entries(sch.properties)) {
      if (name === "_metadata") continue;
      const pv = deref(raw);
      const field = { name, type: respType(pv) };
      const nested = nestedFields(pv);
      if (nested.length > 0) field.fields = nested;
      returns.push(field);
    }
    return returns.length > 0 ? { returns } : {};
  };

  return { describeParam, describeReturns };
}

/** Build the tag → endpoint catalog from a parsed OpenAPI spec. */
export function buildCatalog(spec, { skipOverrides = false } = {}) {
  const { describeParam, describeReturns } = makeResolver(spec);
  const tags = {};
  let rawOps = 0;

  for (const rawPath of Object.keys(spec.paths || {})) {
    const op = spec.paths[rawPath].get;
    if (!op) continue;
    rawOps++;
    const tag = ((op.tags && op.tags[0]) || "untagged").toLowerCase();

    const segs = rawPath.split("/").filter(Boolean);
    if (segs.length < 2) continue;
    const hasParam = segs.some((s) => s.startsWith("{"));
    const name = [...segs].reverse().find((s) => !s.startsWith("{"));
    if (!name || name === tag) continue;

    const params = (op.parameters || []).map(describeParam);
    const pathParam = params.find((p) => p.in === "path");
    const query = params.filter((p) => p.in === "query" && !(p.in === "query" && p.name === "key"));

    // Access level is encoded in the key param's $ref name (ApiKeyMinimal etc.),
    // which deref loses — read it from the raw refs. Stability is a vendor ext.
    const keyRef = (op.parameters || []).map((pr) => pr.$ref || "").find((r) => r.includes("ApiKey"));
    const keyLevel = keyRef ? keyRef.split("/").pop().replace("ApiKey", "").toLowerCase() : undefined;
    const stability = op["x-stability"];
    const { returns, selectionBased } = describeReturns(op);

    tags[tag] = tags[tag] || {};
    const entry = tags[tag][name] || {
      requiresId: false,
      summary: (op.summary || "").trim() || undefined,
      description: (op.description || "").trim() || undefined,
      keyLevel,
      stability,
      query,
    };
    if (returns) entry.returns = returns;
    if (selectionBased) entry.selectionBased = true;
    if (hasParam) {
      entry.idPath = rawPath;
      if (pathParam)
        entry.idParam = {
          name: pathParam.name,
          type: pathParam.type,
          description: pathParam.description,
        };
    } else {
      entry.path = rawPath;
      entry.summary = (op.summary || "").trim() || entry.summary;
      entry.description = (op.description || "").trim() || entry.description;
      entry.keyLevel = keyLevel ?? entry.keyLevel;
      entry.stability = stability ?? entry.stability;
      entry.query = query;
      if (returns) entry.returns = returns;
      if (selectionBased) entry.selectionBased = true;
    }
    tags[tag][name] = entry;
  }

  for (const tag of Object.keys(tags)) {
    for (const nm of Object.keys(tags[tag])) {
      const e = tags[tag][nm];
      e.requiresId = !e.path && !!e.idPath;
      // Reality-derived correction: for endpoints whose spec response shape is
      // wrong, replace the spec-derived `returns` with the real live shape so
      // discovery doesn't mislead agents. Manual overrides are the curated
      // authority; auto-derived ones fill in newly-found structural drifts.
      // `skipOverrides` yields the pure spec shape (used by conformance to
      // detect drift without comparing against its own corrections).
      const ov = skipOverrides
        ? undefined
        : RETURNS_OVERRIDES[`${tag}/${nm}`] ?? GENERATED_OVERRIDES[`${tag}/${nm}`];
      if (ov) {
        e.returns = ov.returns;
        if (ov.note) e.returnsNote = ov.note;
        delete e.selectionBased;
      }
    }
  }

  const tagList = Object.keys(tags).sort();
  const endpoints = tagList.reduce((n, t) => n + Object.keys(tags[t]).length, 0);
  return {
    tags,
    tagList,
    openapiVersion: spec?.info?.version ?? "unknown",
    endpoints,
    rawOps,
  };
}

/** SHA-256 hex of the raw spec text. */
export function specHashOf(specText) {
  return createHash("sha256").update(specText).digest("hex");
}

export function renderEndpointsTs(catalog) {
  const { tags, tagList } = catalog;
  let out =
    "// @license MIT\n" +
    "// AUTO-GENERATED by scripts/generate-endpoints.mjs — do not edit by hand.\n" +
    "// Fully dereferenced from openapi.json ($ref/allOf/oneOf/anyOf resolved).\n" +
    "// Regenerate with: npm run sync-openapi\n";
  out += `
export interface QueryParam {
  name: string;
  in: "query";
  required: boolean;
  type: string;
  enum?: string[];
  description?: string;
}

export interface ResponseField {
  /** Top-level response key (pagination '_metadata' excluded). */
  name: string;
  /** Coarse shape: "array" | "object" | "oneOf" | "anyOf" | scalar type. */
  type: string;
  /** One level of nested field names (array-item or object props). */
  fields?: string[];
}

export interface EndpointDef {
  /** Path without an id (when the endpoint supports it). */
  path?: string;
  /** Path template containing a single {param} placeholder. */
  idPath?: string;
  /** The path parameter, when this endpoint is id-scoped. */
  idParam?: { name: string; type?: string; description?: string };
  /** True when the endpoint can only be called with an id. */
  requiresId: boolean;
  /** Operation summary from the spec. */
  summary?: string;
  /** Operation description from the spec. */
  description?: string;
  /** Minimum API key access level: public | minimal | limited | full. */
  keyLevel?: string;
  /** Torn contract stability: "Stable" | "Unstable" (x-stability). */
  stability?: string;
  /** Accepted query parameters (auth key excluded). */
  query: QueryParam[];
  /** Top-level response shape: envelope keys + one level of nested fields. */
  returns?: ResponseField[];
  /** Why the live shape differs from the spec, when 'returns' was corrected from reality. */
  returnsNote?: string;
  /** True when the 200 body is a oneOf/anyOf union — shape varies by 'selections'. */
  selectionBased?: boolean;
}
`;
  out += `\nexport const ENDPOINTS = ${JSON.stringify(tags, null, 2)} as const satisfies Record<string, Record<string, EndpointDef>>;\n`;
  out += `\nexport type TornTag = keyof typeof ENDPOINTS;\n`;
  out += `\nexport const TAGS = ${JSON.stringify(tagList)} as const;\n`;
  return out;
}

export function renderManifestTs(catalog, specHash) {
  return (
    "// @license MIT\n" +
    "// AUTO-GENERATED by scripts/generate-endpoints.mjs — do not edit by hand.\n" +
    "// Identifies the Torn OpenAPI spec this build was generated from.\n\n" +
    `export const MANIFEST = {\n` +
    `  openapiVersion: ${JSON.stringify(catalog.openapiVersion)},\n` +
    `  specHash: ${JSON.stringify(specHash)},\n` +
    `  tags: ${catalog.tagList.length},\n` +
    `  endpoints: ${catalog.endpoints},\n` +
    `  rawOperations: ${catalog.rawOps},\n` +
    `} as const;\n`
  );
}

/** Stable structural signature of an endpoint (ignores summary/description text). */
function signature(entry) {
  return JSON.stringify({
    path: entry.path ?? null,
    idPath: entry.idPath ?? null,
    requiresId: entry.requiresId,
    query: (entry.query || [])
      .map((q) => ({ n: q.name, req: q.required, en: (q.enum || []).slice().sort() }))
      .sort((a, b) => (a.n < b.n ? -1 : 1)),
  });
}

function flatKeys(tags) {
  const map = new Map();
  for (const tag of Object.keys(tags)) {
    for (const name of Object.keys(tags[tag])) map.set(`${tag}/${name}`, tags[tag][name]);
  }
  return map;
}

/** Diff two catalogs. Returns version delta, tag delta, and endpoint deltas. */
export function diffCatalogs(oldCat, newCat) {
  const oldMap = flatKeys(oldCat.tags);
  const newMap = flatKeys(newCat.tags);
  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;

  for (const key of newMap.keys()) {
    if (!oldMap.has(key)) added.push(key);
    else if (signature(oldMap.get(key)) !== signature(newMap.get(key))) changed.push(key);
    else unchanged++;
  }
  for (const key of oldMap.keys()) {
    if (!newMap.has(key)) removed.push(key);
  }

  const oldTags = new Set(oldCat.tagList);
  const newTags = new Set(newCat.tagList);
  const tagOf = (key) => key.split("/")[0];
  const allTags = [...new Set([...oldCat.tagList, ...newCat.tagList])];
  const perTag = allTags
    .map((tag) => ({
      tag,
      endpoints: Object.keys(newCat.tags[tag] || {}).length,
      added: added.filter((k) => tagOf(k) === tag).length,
      removed: removed.filter((k) => tagOf(k) === tag).length,
      changed: changed.filter((k) => tagOf(k) === tag).length,
    }))
    .sort((a, b) => b.endpoints - a.endpoints || a.tag.localeCompare(b.tag));

  return {
    oldVersion: oldCat.openapiVersion,
    newVersion: newCat.openapiVersion,
    versionChanged: oldCat.openapiVersion !== newCat.openapiVersion,
    addedTags: newCat.tagList.filter((t) => !oldTags.has(t)),
    removedTags: oldCat.tagList.filter((t) => !newTags.has(t)),
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    unchanged,
    oldCount: oldMap.size,
    newCount: newMap.size,
    rawOld: oldCat.rawOps ?? 0,
    rawNew: newCat.rawOps ?? 0,
    perTag,
    hasChanges:
      added.length > 0 ||
      removed.length > 0 ||
      changed.length > 0 ||
      oldCat.openapiVersion !== newCat.openapiVersion,
  };
}

/** Render a human-readable change report (Markdown) with a per-category table. */
export function renderReport(diff) {
  const L = [];
  L.push(
    `**OpenAPI version:** ${
      diff.versionChanged ? `${diff.oldVersion} → ${diff.newVersion}` : `${diff.newVersion} (unchanged)`
    }`,
  );
  if (diff.hasChanges) {
    L.push(
      `**Endpoints:** ${diff.oldCount} → ${diff.newCount} catalog ` +
        `(from ${diff.rawOld} → ${diff.rawNew} raw operations) — ` +
        `+${diff.added.length} −${diff.removed.length} ~${diff.changed.length}, ${diff.unchanged} unchanged`,
    );
  } else {
    L.push(
      `**Endpoints:** ${diff.newCount} catalog (from ${diff.rawNew} raw operations) — no changes`,
    );
  }

  L.push("");
  L.push("| Category | Endpoints | + Added | − Removed | ~ Changed |");
  L.push("|----------|-----------|---------|-----------|-----------|");
  const cell = (n, sign) => (n > 0 ? `${sign}${n}` : "0");
  for (const r of diff.perTag) {
    L.push(
      `| ${r.tag} | ${r.endpoints} | ${cell(r.added, "+")} | ${cell(r.removed, "−")} | ${r.changed} |`,
    );
  }
  L.push(
    `| **Total** | **${diff.newCount}** | **${cell(diff.added.length, "+")}** | ` +
      `**${cell(diff.removed.length, "−")}** | **${diff.changed.length}** |`,
  );

  if (diff.addedTags.length) L.push(`\n**New tags:** ${diff.addedTags.join(", ")}`);
  if (diff.removedTags.length) L.push(`**Removed tags:** ${diff.removedTags.join(", ")}`);
  if (diff.added.length) L.push(`\n**Added:** ${diff.added.join(", ")}`);
  if (diff.removed.length) L.push(`**Removed:** ${diff.removed.join(", ")}`);
  if (diff.changed.length) L.push(`**Changed (params/enums):** ${diff.changed.join(", ")}`);
  return L.join("\n");
}
