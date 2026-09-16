// @license MIT
// Live conformance harness. Calls every Torn endpoint with TORN_TEST_API_KEY,
// validates each real response against its OpenAPI response schema (ajv), and
// writes a report.
//
//   node scripts/conformance.mjs              # full live run (needs the key)
//   node scripts/conformance.mjs --compile    # compile every validator, no calls
//
// Helpers split into:
//   scripts/lib/conformance-seeds.mjs   — SEEDS, PARAM_SEEDS, DOCUMENTED_SKIPS, PARAM_OVERRIDES
//   scripts/lib/conformance-report.mjs  — buildMainReport, buildDevReport
//   scripts/lib/conformance-baseline.mjs — reconcileBaseline
//   scripts/lib/conformance-filter.mjs  — classifyErrors
//   scripts/lib/conformance-throttle.mjs — rate-limit helpers
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildCatalog } from "./lib/catalog.mjs";
import {
  createConformanceThrottle,
  parsePositiveInt,
  DEFAULT_RATE_LIMIT_BATCH,
  DEFAULT_RATE_LIMIT_PAUSE_MS,
  DEFAULT_MIN_CALL_SPACING_MS,
} from "./lib/conformance-throttle.mjs";
import { RETURNS_OVERRIDES } from "./lib/returns-overrides.mjs";
import { buildDevFindings } from "./lib/dev-findings.mjs";
import { relaxOverlappingOneOf } from "./lib/relax-oneof.mjs";
import { classifyErrors } from "./lib/conformance-filter.mjs";
import { reconcileBaseline } from "./lib/conformance-baseline.mjs";
import { shouldAutoOverride } from "./lib/auto-override.mjs";
import { SEEDS, PARAM_SEEDS, PARAM_OVERRIDES, DOCUMENTED_SKIPS } from "./lib/conformance-seeds.mjs";
import { buildMainReport, buildDevReport } from "./lib/conformance-report.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = JSON.parse(readFileSync(join(root, "openapi.json"), "utf8"));
const catalog = buildCatalog(spec);
// Pure spec shapes (no overrides) — the baseline we detect live drift against.
const specCatalog = buildCatalog(spec, { skipOverrides: true });
const KEY = process.env.TORN_TEST_API_KEY;
const COMPILE_ONLY = process.argv.includes("--compile") || !KEY;

// verbose: errors carry the offending live value (e.data) for evidence notes.
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, verbose: true });
addFormats(ajv);
// Validation only — relaxOverlappingOneOf's clone never feeds the catalog or
// dev report, both of which keep reading the original `spec`.
ajv.addSchema(relaxOverlappingOneOf(spec), "spec");

/** Response schema $ref name for a catalog endpoint, via its spec path. */
function responseRef(def) {
  const p = def.path ?? def.idPath;
  const s = spec.paths?.[p]?.get?.responses?.["200"]?.content?.["application/json"]?.schema;
  return s?.$ref ? s.$ref.split("/").pop() : null;
}

function validatorFor(name) {
  const ref = `spec#/components/schemas/${name}`;
  try {
    return ajv.getSchema(ref) ?? ajv.compile({ $ref: ref });
  } catch (e) {
    return { _compileError: e.message };
  }
}

// ── Throttle (proactive batches + reactive Torn code 5 retry) ────────
// Tune with:
// - TORN_CONFORMANCE_RATE_LIMIT_BATCH (or TORN_RATE_LIMIT_BATCH), default 90
// - TORN_CONFORMANCE_RATE_LIMIT_PAUSE_MS (or TORN_RATE_LIMIT_PAUSE_MS), default 60000
const RATE_LIMIT_BATCH = parsePositiveInt(
  process.env.TORN_CONFORMANCE_RATE_LIMIT_BATCH ?? process.env.TORN_RATE_LIMIT_BATCH,
  DEFAULT_RATE_LIMIT_BATCH,
);
const RATE_LIMIT_PAUSE_MS = parsePositiveInt(
  process.env.TORN_CONFORMANCE_RATE_LIMIT_PAUSE_MS ?? process.env.TORN_RATE_LIMIT_PAUSE_MS,
  DEFAULT_RATE_LIMIT_PAUSE_MS,
);

const throttle = createConformanceThrottle({
  batchSize: RATE_LIMIT_BATCH,
  pauseMs: RATE_LIMIT_PAUSE_MS,
  minCallSpacingMs: DEFAULT_MIN_CALL_SPACING_MS,
  onBatchPause: ({ requestsInBatch, pauseMs }) => {
    console.log(
      `[conformance] Sent ${requestsInBatch} Torn requests; pausing ${Math.round(
        pauseMs / 1000,
      )}s to avoid rate limits.`,
    );
  },
  onRetry: ({ pauseMs }) => {
    console.warn(
      `[conformance] Torn 5: Too many requests. Waiting ${Math.round(
        pauseMs / 1000,
      )}s and retrying once...`,
    );
  },
});

function buildUrl(path, params) {
  const u = new URL(`https://api.torn.com/v2${path}`);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, String(v));
  u.searchParams.set("key", KEY);
  return u.toString();
}

/** Required query params filled with their first documented enum value. */
function defaultParams(def) {
  const params = {};
  for (const q of def.query) {
    if (q.required && q.enum && q.enum.length) params[q.name] = q.enum[0];
  }
  return params;
}

const cache = new Map(); // source "tag/ep" or "ctx:userId" → resolved value
async function tornGet(path, params) {
  return throttle.run(async () => {
    const t = Date.now();
    let res, json, err;
    try {
      res = await fetch(buildUrl(path, params), { headers: { "User-Agent": "torn-mcp-conformance" } });
      json = await res.json();
      if (json && json.error) err = `Torn ${json.error.code}: ${json.error.error}`;
    } catch (e) {
      err = e.message;
    }
    return { json, err, ms: Date.now() - t, status: res?.status };
  });
}

/** Collapse array indices so repeated per-item errors read as one. */
/**
 * Display-only evidence for a validation error: the live value ajv saw, and for
 * enums the values the spec allows. NEVER folded into the reason strings — those
 * are matched against conformance-baseline.json and must stay stable while live
 * sample values change run to run.
 */
function liveNote(e) {
  if (!("data" in e)) return null;
  const v = e.data;
  const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
  let sample = JSON.stringify(v);
  // keep table cells intact: short, no pipes/backticks
  if (typeof sample === "string") {
    sample = sample.replace(/[|`]/g, "'");
    if (sample.length > 60) sample = sample.slice(0, 57) + "...";
  }
  if (e.keyword === "type") {
    return `live API returns ${t}${sample !== undefined && t !== "null" ? ` (e.g. ${sample})` : ""}`;
  }
  if (e.keyword === "enum") {
    const parts = [`live value: ${sample}`];
    let allowed = (e.params?.allowedValues ?? []).map((x) => JSON.stringify(x)).join(", ");
    if (allowed) {
      allowed = allowed.replace(/[|`]/g, "'");
      if (allowed.length > 100) allowed = allowed.slice(0, 97) + "...";
      parts.push(`spec allows: ${allowed}`);
    }
    return parts.join("; ");
  }
  // required/additionalProperties already name the field in the reason
  return null;
}

function normPath(p) {
  return (p || "(root)").replace(/\/\d+/g, "/*");
}

/** Turn a raw ajv error into a plain-English reason. */
function explain(e) {
  const at = normPath(e.instancePath);
  switch (e.keyword) {
    case "required":
      return `missing required field '${e.params?.missingProperty}' (at ${at})`;
    case "type":
      return `wrong type at ${at} — schema expects ${e.params?.type}`;
    case "enum":
      return `value at ${at} is not one of the allowed values`;
    case "additionalProperties":
      return `unexpected extra field '${e.params?.additionalProperty}' at ${at}`;
    case "oneOf":
      return `value at ${at} matches more than one schema branch — unexpected overlap, not one relax-oneof.mjs already accounts for`;
    default:
      return `${at}: ${e.message}`;
  }
}

// First item of the first non-meta array. With `where` (field→value map), pick
// the first item matching all conditions instead of just [0].
function firstArrayItem(json, where) {
  if (!json || typeof json !== "object") return undefined;
  for (const k of Object.keys(json)) {
    if (k.startsWith("_")) continue;
    if (Array.isArray(json[k]) && json[k].length) {
      const arr = json[k];
      if (!where) return arr[0];
      return arr.find((it) => it && Object.entries(where).every(([f, v]) => it[f] === v));
    }
  }
  return undefined;
}

// Read a possibly-nested field by dot path (e.g. "item.uid").
function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Fetch a list source once and pluck `field` (dot path) from the first item
// matching `where`. Cached by source+field so two consumers of the same source
// (e.g. auctionhouselisting wants id, itemdetails wants item.uid) don't collide.
async function pluckFromSource(source, field = "id", sourceParams, where) {
  const ck = `pluck:${source}:${field}`;
  if (cache.has(ck)) return cache.get(ck);
  const def = catalog.tags[source.split("/")[0]]?.[source.split("/")[1]];
  if (!def) return null;
  const path = def.path ?? def.idPath;
  const params = { ...defaultParams(def), ...(sourceParams ?? {}) };
  const item = firstArrayItem((await tornGet(path, params)).json, where);
  const val = getPath(item, field);
  const out = val != null ? String(val) : null;
  if (out) cache.set(ck, out);
  return out;
}

let ctx; // { userId, factionId, companyId }
async function bootstrap() {
  const basic = (await tornGet("/user/basic", {})).json;
  const profile = (await tornGet("/user/profile", {})).json;
  const job = (await tornGet("/user/job", {})).json;
  ctx = {
    userId: basic?.basic?.id != null ? String(basic.basic.id) : undefined,
    factionId: profile?.profile?.faction_id ? String(profile.profile.faction_id) : undefined,
    companyId: job?.job?.company_id != null ? String(job.job.company_id) : undefined,
  };
}

/** Resolve an id for an id-required endpoint, or null to skip. */
async function resolveId(tag, name) {
  const key = `${tag}/${name}`;
  // Self entity endpoints: user/{id}/*, faction/{id}/*, company/{id}/*.
  const seed = SEEDS[key];
  if (!seed) {
    if (tag === "user" && ctx.userId) return ctx.userId;
    if (tag === "faction" && ctx.factionId) return ctx.factionId;
    if (tag === "company" && ctx.companyId) return ctx.companyId;
    return null; // no seed — reported
  }
  if (seed.kind === "const") return seed.value;
  if (seed.kind === "item") {
    if (cache.has("itemId")) return cache.get("itemId");
    const items = (await tornGet("/torn/items", {})).json?.items;
    const id = Array.isArray(items) && items[0]?.id != null ? String(items[0].id) : null;
    if (id) cache.set("itemId", id);
    return id;
  }
  if (seed.kind === "list") {
    return pluckFromSource(seed.source, seed.field ?? "id", seed.sourceParams, seed.where);
  }
  return null;
}

function fillId(template, id) {
  return template.replace(/\{[^}]+\}/, encodeURIComponent(id));
}

// ── Auto-derived overrides ──────────────────────────────────────────
// When a real response structurally diverges from the spec — a different
// top-level container type, or a different envelope key set — capture the live
// shape so discovery reflects reality. STRUCTURAL drift only; never nested
// field-set differences, which are account-dependent (missing optional data
// must not narrow a documented shape). Endpoints already corrected manually are
// left to the curated manual overrides.
const generatedOverrides = {};

/** Top-level response shape from a live JSON body: envelope keys + one nested level. */
function liveShape(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const out = [];
  for (const k of Object.keys(json)) {
    if (k.startsWith("_")) continue; // pagination / enrichment metadata
    const v = json[k];
    const type = Array.isArray(v) ? "array" : v && typeof v === "object" ? "object" : typeof v;
    const item = Array.isArray(v) ? v[0] : v;
    const fields = item && typeof item === "object" && !Array.isArray(item) ? Object.keys(item) : [];
    const entry = { name: k, type };
    if (fields.length) entry.fields = fields;
    out.push(entry);
  }
  return out.length ? out : null;
}

/**
 * Record an auto-override when a live response's container type contradicts the
 * spec for a key the spec defines. Schema structure wins otherwise: a different
 * key set or a union-typed key is left to the validator to report as drift (see
 * lib/auto-override.mjs).
 */
function recordOverride(tag, name, json) {
  if (RETURNS_OVERRIDES[`${tag}/${name}`]) return; // manual is the authority
  const live = liveShape(json);
  if (!live) return; // no data on the test account — don't override
  const specReturns = specCatalog.tags[tag]?.[name]?.returns;
  if (!specReturns) return; // selection-based or no documented shape
  if (!shouldAutoOverride(specReturns, live)) return;
  generatedOverrides[`${tag}/${name}`] = {
    note: "auto-derived from live response (container type differs from spec)",
    returns: live,
  };
}

// ── Main ────────────────────────────────────────────────────────────
const results = [];
const compileIssues = [];

if (!COMPILE_ONLY) await bootstrap();

for (const tag of catalog.tagList) {
  for (const [name, def] of Object.entries(catalog.tags[tag])) {
    const refName = responseRef(def);
    const validate = refName ? validatorFor(refName) : null;
    if (validate && validate._compileError) compileIssues.push(`${tag}/${name}: ${validate._compileError}`);

    if (COMPILE_ONLY) {
      results.push({ ep: `${tag}/${name}`, status: validate?._compileError ? "schema-error" : "compilable", schema: refName });
      continue;
    }

    // Determine the path to call.
    let path = def.path;
    let params = { ...defaultParams(def), ...(PARAM_OVERRIDES[`${tag}/${name}`] ?? {}) };
    let note = "";
    if (!path) {
      const id = await resolveId(tag, name);
      if (!id) {
        results.push({ ep: `${tag}/${name}`, status: "skip", note: "no sample id" });
        continue;
      }
      path = fillId(def.idPath, id);
    }

    // Inject a required query param whose value must come from live data.
    const pseed = PARAM_SEEDS[`${tag}/${name}`];
    if (pseed) {
      const val = await pluckFromSource(pseed.source, pseed.field ?? "id", pseed.sourceParams, pseed.where);
      if (val == null) {
        results.push({ ep: `${tag}/${name}`, status: "skip", note: `no '${pseed.param}' seed from ${pseed.source}` });
        continue;
      }
      params = { ...params, [pseed.param]: val };
    }

    const { json, err, ms } = await tornGet(path, params);
    if (err) {
      // A Torn error means we couldn't build a valid request (bad seed/param)
      // or the response isn't data — not a schema mismatch. Skip, don't fail.
      results.push({ ep: `${tag}/${name}`, status: "skip", ms, note: err });
      continue;
    }
    recordOverride(tag, name, json); // capture live shape if it structurally drifts
    let status = "pass";
    let reasons = [];
    let evidence = {};
    let devFindings = [];
    if (validate && !validate._compileError) {
      if (!validate(json)) {
        const errs = validate.errors ?? [];
        // relaxOverlappingOneOf already turns Torn's overlap-prone oneOf schemas
        // into anyOf before validation; classifyErrors is the safety net for
        // whatever still reaches ajv as an ambiguous oneOf failure.
        const classified = classifyErrors(errs);
        status = classified.status;
        const relevant = classified.relevant;
        reasons = [...new Set(relevant.map(explain))];
        for (const e of relevant) {
          const key = explain(e);
          if (evidence[key] === undefined) {
            const n = liveNote(e);
            if (n) evidence[key] = n;
          }
        }
        // Forum-ready statement + trimmed sample payload + closing note per
        // mismatch, built while the live body is still in scope. Display-only.
        if (status === "fail") devFindings = buildDevFindings(json, relevant);
      }
    } else {
      reasons = ["no schema to validate against"];
    }
    results.push({ ep: `${tag}/${name}`, status, ms, reasons, evidence, devFindings, note });
  }
}

// ── Emit auto-derived overrides ─────────────────────────────────────
// Write the structural-drift shapes captured this run (live mode only). Sorted,
// no timestamps → stable diffs. `npm run generate` bakes these into the catalog.
if (!COMPILE_ONLY) {
  const sorted = {};
  for (const k of Object.keys(generatedOverrides).sort()) sorted[k] = generatedOverrides[k];
  writeFileSync(
    join(root, "scripts", "lib", "returns-overrides.generated.json"),
    JSON.stringify(sorted, null, 2) + "\n",
  );
}

// ── Baseline reconciliation ─────────────────────────────────────────
// Known drift (Torn's standing spec bugs) is recorded in conformance-baseline.json
// so the run fails only on NEW drift, not Torn's existing mistakes.
const BASELINE_PATH = join(root, "conformance-baseline.json");
const driftResults = results.filter((r) => r.status === "fail");

// --update-baseline: snapshot current drift as accepted, then exit.
if (process.argv.includes("--update-baseline")) {
  const out = {};
  for (const r of driftResults) out[r.ep] = r.reasons ?? [];
  writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`Baseline updated: ${Object.keys(out).length} endpoints recorded as known drift.`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : {};
// newDrift fails the run; knownDrift is accepted; resolved needs RUNTIME
// evidence (a compile-check run or a skipped endpoint can never resolve a
// baseline entry — those land in notEvaluated). See lib/conformance-baseline.mjs.
const { newDrift, knownDrift, resolved, notEvaluated } = reconcileBaseline(results, baseline, {
  compileOnly: COMPILE_ONLY,
});

// ── Classify results for reporting ──────────────────────────────────
const pass = results.filter((r) => r.status === "pass");
const smells = results.filter((r) => r.status === "smell");
const skips = results.filter((r) => r.status === "skip");
// Split skips like drift: documented (expected, can't-seed) vs unexpected (a
// seed broke or a new endpoint needs one — worth a look).
const documentedSkips = skips.filter((r) => DOCUMENTED_SKIPS[r.ep]);
const unexpectedSkips = skips.filter((r) => !DOCUMENTED_SKIPS[r.ep]);
// Documented skips that now return data → they could be validated; nudge to
// drop them from DOCUMENTED_SKIPS (mirror of the baseline's "resolved").
const nowTestable = COMPILE_ONLY
  ? []
  : Object.keys(DOCUMENTED_SKIPS).filter((ep) => {
      const r = results.find((x) => x.ep === ep);
      return r && r.status !== "skip";
    });

// ── Build and write reports ──────────────────────────────────────────
const report = buildMainReport({
  catalog,
  results,
  pass,
  newDrift,
  knownDrift,
  resolved,
  notEvaluated,
  smells,
  skips,
  documentedSkips,
  unexpectedSkips,
  nowTestable,
  compileIssues,
  DOCUMENTED_SKIPS,
  compileOnly: COMPILE_ONLY,
});
console.log(report);
writeFileSync(join(root, "conformance-report.md"), report + "\n");

// The dev report is live-mode only — a compile-check run has no pass/drift data
// and would misreport everything.
let devReport = null;
if (!COMPILE_ONLY) {
  devReport = buildDevReport({ catalog, results, pass, newDrift, knownDrift, skips, resolved, responseRef });
  writeFileSync(join(root, "conformance-for-torn.md"), devReport);
}

writeFileSync(
  join(root, "conformance.json"),
  JSON.stringify(
    {
      summary: {
        pass: pass.length,
        newDrift: newDrift.length,
        knownDrift: knownDrift.length,
        resolved: resolved.length,
        smell: smells.length,
        skip: skips.length,
        unexpectedSkip: unexpectedSkips.length,
        documentedSkip: documentedSkips.length,
      },
      results,
    },
    null,
    2,
  ),
);
// CI run summary: maintenance report first, then the forum-ready dev report —
// otherwise the dev report regenerated in-workspace is discarded unseen.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
  if (devReport) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "\n---\n\n" + devReport);
}

// Fail the run ONLY on new drift — known Torn spec bugs don't break the pipeline.
console.log(`\n${newDrift.length} new drift failure(s); ${knownDrift.length} known (accepted).`);
process.exit(newDrift.length > 0 ? 1 : 0);
