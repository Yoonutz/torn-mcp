// @license MIT
// Live conformance harness. Calls every Torn endpoint with TORN_TEST_API_KEY,
// validates each real response against its OpenAPI response schema (ajv), and
// writes a report. See docs/superpowers/specs/2026-06-15-live-conformance-harness-design.md
//
//   node scripts/conformance.mjs              # full live run (needs the key)
//   node scripts/conformance.mjs --compile    # compile every validator, no calls
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
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
  "market/auctionhouselisting": { kind: "item" },
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
    let params = defaultParams(def);
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
      const permission = /incorrect key|access level|permission/i.test(err);
      results.push({ ep: `${tag}/${name}`, status: permission ? "skip" : "fail", ms, note: err });
      continue;
    }
    let status = "pass";
    let validationErr = "";
    if (validate && !validate._compileError) {
      const ok = validate(json);
      if (!ok) {
        status = "fail";
        validationErr = (validate.errors ?? [])
          .slice(0, 3)
          .map((e) => `${e.instancePath || "/"} ${e.message}`)
          .join("; ");
      }
    } else {
      note = "no/uncompilable schema";
    }
    results.push({ ep: `${tag}/${name}`, status, ms, note: validationErr || note });
  }
}

// ── Report ──────────────────────────────────────────────────────────
const counts = results.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
const failed = results.filter((r) => r.status === "fail");
const lines = [];
lines.push(`# Torn conformance report`);
lines.push("");
lines.push(`OpenAPI ${catalog.openapiVersion} · ${results.length} endpoints · mode: ${COMPILE_ONLY ? "compile-check (no calls)" : "live"}`);
lines.push("");
lines.push(`**Totals:** ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
if (failed.length) {
  lines.push("");
  lines.push("## Failures");
  lines.push("| Endpoint | ms | Detail |");
  lines.push("|----------|----|--------|");
  for (const r of failed) lines.push(`| ${r.ep} | ${r.ms ?? ""} | ${r.note ?? ""} |`);
}
if (compileIssues.length) {
  lines.push("");
  lines.push("## Schemas ajv could not compile");
  for (const c of compileIssues) lines.push(`- ${c}`);
}
const report = lines.join("\n");
console.log(report);
writeFileSync(join(root, "conformance-report.md"), report + "\n");
writeFileSync(join(root, "conformance.json"), JSON.stringify({ counts, results }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");

// Fail the run only on real schema-validation failures.
const schemaFailures = failed.length;
console.log(`\n${schemaFailures} schema failure(s).`);
process.exit(schemaFailures > 0 ? 1 : 0);
