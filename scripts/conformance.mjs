// @license MIT
// Live conformance harness. Calls every Torn endpoint with TORN_TEST_API_KEY,
// validates each real response against its OpenAPI response schema (ajv), and
// writes a report. See docs/superpowers/specs/2026-06-15-live-conformance-harness-design.md
//
//   node scripts/conformance.mjs              # full live run (needs the key)
//   node scripts/conformance.mjs --compile    # compile every validator, no calls
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildCatalog } from "./lib/catalog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = JSON.parse(readFileSync(join(root, "openapi.json"), "utf8"));
const catalog = buildCatalog(spec);
const KEY = process.env.TORN_TEST_API_KEY;
const COMPILE_ONLY = process.argv.includes("--compile") || !KEY;

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
addFormats(ajv);
ajv.addSchema(spec, "spec");

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

// ── Seed map: how to obtain an id for each id-required endpoint ──────
// kind: "const" | "item" | "list" (pluck first array item's `field`, default id)
const SEEDS = {
  "company/companies": { kind: "const", value: "1" },
  "market/properties": { kind: "const", value: "1" },
  "market/rentals": { kind: "const", value: "1" },
  "market/itemmarket": { kind: "item" },
  "market/auctionhouselisting": { kind: "list", source: "market/auctionhouse" },
  "torn/itemdetails": { kind: "item" },
  "faction/crime": { kind: "list", source: "faction/crimes" },
  "faction/raidreport": { kind: "list", source: "faction/raids" },
  "faction/rankedwarreport": { kind: "list", source: "faction/rankedwars" },
  "faction/territorywarreport": { kind: "list", source: "faction/territorywars" },
  "forum/thread": { kind: "list", source: "forum/threads" },
  "forum/posts": { kind: "list", source: "forum/threads" },
  "racing/race": { kind: "list", source: "racing/races" },
  "racing/records": { kind: "list", source: "racing/tracks" },
  "torn/subcrimes": { kind: "list", source: "torn/organizedcrimes" },
  "user/crimes": { kind: "list", source: "user/organizedcrimes" },
  "user/trade": { kind: "list", source: "user/trades" },
  "torn/eliminationteam": { kind: "list", source: "torn/elimination" },
};

// ── Throttle (≈90/min, under Torn's 100/min) ────────────────────────
let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gate() {
  const wait = 650 - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

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

// Some endpoints mark a param optional but the API needs it (e.g. inventory and
// personalstats require a category). Supply a valid value so they can be tested.
const PARAM_OVERRIDES = {
  "user/inventory": { cat: "Collectible" },
  "user/personalstats": { cat: "all" },
};

const cache = new Map(); // source "tag/ep" or "ctx:userId" → resolved value
async function tornGet(path, params) {
  await gate();
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
}

/** Collapse array indices so repeated per-item errors read as one. */
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
      return `value at ${at} matches more than one schema branch (Torn enum|string overlap)`;
    default:
      return `${at}: ${e.message}`;
  }
}

function firstArrayItem(json) {
  if (!json || typeof json !== "object") return undefined;
  for (const k of Object.keys(json)) {
    if (k.startsWith("_")) continue;
    if (Array.isArray(json[k]) && json[k].length) return json[k][0];
  }
  return undefined;
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
    if (cache.has(seed.source)) return cache.get(seed.source);
    const def = catalog.tags[seed.source.split("/")[0]]?.[seed.source.split("/")[1]];
    if (!def) return null;
    const path = def.path ?? def.idPath;
    const item = firstArrayItem((await tornGet(path, defaultParams(def))).json);
    const id = item?.[seed.field ?? "id"] != null ? String(item[seed.field ?? "id"]) : null;
    if (id) cache.set(seed.source, id);
    return id;
  }
  return null;
}

function fillId(template, id) {
  return template.replace(/\{[^}]+\}/, encodeURIComponent(id));
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

    const { json, err, ms } = await tornGet(path, params);
    if (err) {
      // A Torn error means we couldn't build a valid request (bad seed/param)
      // or the response isn't data — not a schema mismatch. Skip, don't fail.
      results.push({ ep: `${tag}/${name}`, status: "skip", ms, note: err });
      continue;
    }
    let status = "pass";
    let reasons = [];
    if (validate && !validate._compileError) {
      if (!validate(json)) {
        const errs = validate.errors ?? [];
        // Torn's spec uses `oneOf: [Enum, string]`, where a value matches both
        // branches. That's a known spec smell, not drift. Only non-oneOf errors
        // (missing fields, wrong types) are real failures.
        const onlyOneOf = errs.every((e) => e.keyword === "oneOf");
        status = onlyOneOf ? "smell" : "fail";
        const relevant = status === "fail" ? errs.filter((e) => e.keyword !== "oneOf") : errs;
        reasons = [...new Set(relevant.map(explain))];
      }
    } else {
      reasons = ["no schema to validate against"];
    }
    results.push({ ep: `${tag}/${name}`, status, ms, reasons, note });
  }
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
// Normalize for matching so minor formatting (dashes, spacing, case) in the
// baseline doesn't false-flag; field names + paths still must match.
const norm = (s) => s.toLowerCase().replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
const newDrift = []; // drift not in the baseline → fail the run
const knownDrift = []; // drift already accepted → reported, not fatal
for (const r of driftResults) {
  const accepted = (baseline[r.ep] ?? []).map(norm);
  const fresh = (r.reasons ?? []).filter((x) => !accepted.includes(norm(x)));
  if (fresh.length) {
    r.newReasons = fresh;
    newDrift.push(r);
  } else {
    knownDrift.push(r);
  }
}
// Resolved: baseline entries Torn has since fixed → prompt to prune the baseline.
const resolved = [];
for (const [ep, reasons] of Object.entries(baseline)) {
  const cur = results.find((r) => r.ep === ep);
  const stillThere = (cur?.status === "fail" ? (cur.reasons ?? []) : []).map(norm);
  const gone = reasons.filter((x) => !stillThere.includes(norm(x)));
  if (gone.length) resolved.push({ ep, gone });
}

// ── Report (human-first) ────────────────────────────────────────────
const pass = results.filter((r) => r.status === "pass");
const smells = results.filter((r) => r.status === "smell");
const skips = results.filter((r) => r.status === "skip");

const lines = [];
lines.push(`# Torn conformance report`);
lines.push("");
lines.push(`OpenAPI ${catalog.openapiVersion} · ${results.length} endpoints · mode: ${COMPILE_ONLY ? "compile-check (no calls)" : "live"}`);
lines.push("");
lines.push(
  `**${pass.length} ok** · **${newDrift.length} NEW drift** · ` +
    `${knownDrift.length} known drift · ${smells.length} spec smell · ${skips.length} not tested`,
);

if (newDrift.length) {
  lines.push("");
  lines.push(`## ❌ NEW drift — fails the run, look at these (${newDrift.length})`);
  lines.push("Not in the baseline — something changed since it was accepted.");
  lines.push("");
  lines.push("| Endpoint | What's new |");
  lines.push("|----------|-----------|");
  for (const r of newDrift) lines.push(`| \`${r.ep}\` | ${(r.newReasons ?? []).join("<br>") || "—"} |`);
}

if (resolved.length) {
  lines.push("");
  lines.push(`## ✅ Resolved — Torn fixed these; prune the baseline (${resolved.length})`);
  for (const r of resolved) lines.push(`- \`${r.ep}\`: ${r.gone.join("; ")}`);
}

if (knownDrift.length) {
  lines.push("");
  lines.push(`## 🟡 Known drift — accepted Torn spec bugs, not failing (${knownDrift.length})`);
  lines.push("| Endpoint | What's wrong |");
  lines.push("|----------|--------------|");
  for (const r of knownDrift) lines.push(`| \`${r.ep}\` | ${(r.reasons ?? []).join("<br>") || "—"} |`);
}

if (smells.length) {
  lines.push("");
  lines.push(`## ⚠️ Spec smells — ignore (${smells.length})`);
  lines.push(
    "Torn documents some fields as `enum OR string`, so a value matches both — a quirk in " +
      "Torn's docs, not a real mismatch. Endpoints: " +
      smells.map((r) => `\`${r.ep}\``).join(", "),
  );
}

if (skips.length) {
  lines.push("");
  lines.push(`## ⏭️ Not tested — couldn't build a valid request (${skips.length})`);
  lines.push("Usually a missing sample id or a category the test didn't supply.");
  lines.push("");
  lines.push("| Endpoint | Why |");
  lines.push("|----------|-----|");
  for (const r of skips) lines.push(`| \`${r.ep}\` | ${r.note ?? ""} |`);
}

if (compileIssues.length) {
  lines.push("");
  lines.push(`## Schemas that wouldn't compile (${compileIssues.length})`);
  for (const c of compileIssues) lines.push(`- ${c}`);
}

const report = lines.join("\n");
console.log(report);
writeFileSync(join(root, "conformance-report.md"), report + "\n");
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
      },
      results,
    },
    null,
    2,
  ),
);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");

// Fail the run ONLY on new drift — known Torn spec bugs don't break the pipeline.
console.log(`\n${newDrift.length} new drift failure(s); ${knownDrift.length} known (accepted).`);
process.exit(newDrift.length > 0 ? 1 : 0);
