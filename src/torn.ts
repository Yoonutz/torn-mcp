// @license MIT
// Pure helpers for talking to the Torn City API v2. No Worker globals here so
// these stay unit-testable in plain Node.
import { ENDPOINTS, type EndpointDef, type QueryParam, type TornTag } from "./generated/endpoints.js";

/** Fixed Torn API host. Never user-controlled (SSRF guard). */
export const TORN_API_BASE = "https://api.torn.com/v2";

function fillId(template: string, id: string): string {
  return template.replace(/\{[^}]+\}/, encodeURIComponent(id));
}

/**
 * Resolve a tag + endpoint (+ optional id) to a concrete Torn v2 path.
 * Throws if the tag/endpoint is unknown or an id is required but missing.
 */
export function resolveEndpointPath(
  tag: string,
  endpoint: string,
  id?: string,
): string {
  const tagMap = ENDPOINTS[tag as TornTag] as
    | Record<string, EndpointDef>
    | undefined;
  if (!tagMap) throw new Error(`Unknown tag '${tag}'.`);
  const def = tagMap[endpoint];
  if (!def) throw new Error(`Unknown endpoint '${endpoint}' for tag '${tag}'.`);

  if (def.requiresId) {
    if (!id) throw new Error(`Endpoint '${endpoint}' requires an id.`);
    return fillId(def.idPath as string, id);
  }
  if (id && def.idPath) return fillId(def.idPath, id);
  return def.path as string;
}

/**
 * Validate query params against the endpoint catalog before calling Torn:
 * required params present, enum params within range. Returns a helpful message
 * the model can act on, or null when valid.
 */
export function validateParams(
  tag: string,
  endpoint: string,
  params: Record<string, string | number> = {},
  id?: string,
): string | null {
  const tagMap = ENDPOINTS[tag as TornTag] as
    | Record<string, EndpointDef>
    | undefined;
  const def = tagMap?.[endpoint];
  if (!def) return null; // unknown endpoint handled by resolveEndpointPath

  // Schema-grounded id check: when the path id is typed integer, reject a
  // non-numeric value (e.g. an item name) up front instead of letting Torn
  // return an opaque "Incorrect ID".
  if (
    id !== undefined &&
    id !== "" &&
    def.idParam?.type === "integer" &&
    !/^\d+$/.test(String(id))
  ) {
    return `'${id}' is not a valid id for endpoint '${endpoint}' — it must be a numeric Torn id.`;
  }

  for (const q of def.query) {
    const val = params[q.name];
    const missing = val === undefined || val === "";
    if (q.required && missing) {
      const allowed = q.enum ? ` (one of: ${q.enum.join(", ")})` : "";
      return `Endpoint '${endpoint}' requires query param '${q.name}'${allowed}.`;
    }
    if (!missing && q.enum) {
      // Some enum params (e.g. faction/news `cat`) accept a comma-separated
      // list. Validate each token against the enum.
      const bad = String(val)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((v) => !q.enum!.includes(v));
      if (bad.length > 0) {
        return `Invalid ${q.name} value${bad.length > 1 ? "s" : ""} '${bad.join(", ")}' for endpoint '${endpoint}'. Allowed: ${q.enum.join(", ")}.`;
      }
    }
  }
  return null;
}

/**
 * Format an endpoint's params for a tool description: required params, plus
 * optional params that carry an enum (e.g. `cat` on items/inventory) — those
 * are the ones the model needs to know exist to get useful results.
 */
export function paramsHint(def: EndpointDef): string {
  // Show the full enum — the model needs every value (e.g. inventory cat=Drug).
  const fmtEnum = (q: QueryParam): string => `${q.name}=${(q.enum ?? []).join("|")}`;
  const segs: string[] = [];
  const reqs = def.query.filter((q) => q.required).map((q) => (q.enum ? fmtEnum(q) : q.name));
  if (reqs.length) segs.push(`requires ${reqs.join(", ")}`);
  const optEnums = def.query
    .filter((q) => !q.required && q.enum && q.enum.length > 0)
    .map(fmtEnum);
  if (optEnums.length) segs.push(`filter ${optEnums.join(", ")}`);
  return segs.length ? ` · ${segs.join(" · ")}` : "";
}

/**
 * Compact badges for a tool description: the required key level (shown only when
 * above the default `public`) and an unstable-contract warning.
 */
export function endpointBadges(def: EndpointDef): string {
  const badges: string[] = [];
  if (def.keyLevel && def.keyLevel !== "public") badges.push(`[key: ${def.keyLevel}]`);
  if (def.stability === "Unstable") badges.push("⚠ unstable");
  return badges.length ? ` ${badges.join(" ")}` : "";
}

const TS_MIN = 1_000_000_000; // 2001-09
const TS_MAX = 4_000_000_000; // 2096-10

const TS_KEYS = new Set([
  "timestamp", "cache_timestamp", "signed_up", "until",
  "started", "ended", "executed", "created", "updated", "expires", "seen", "date",
]);

function isTimestampKey(key: string): boolean {
  return TS_KEYS.has(key) || key.endsWith("_at");
}

/**
 * Format epoch seconds as Torn City Time (TCT = UTC), matching the in-game log
 * display: `HH:MM:SS - DD/MM/YY` (24-hour).
 */
function toHuman(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  const date = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCFullYear() % 100)}`;
  return `${time} - ${date}`;
}

/**
 * Additive, non-destructive enrichment: keep every epoch-seconds field as-is
 * (the canonical value the schema describes) and add a readable Torn City Time
 * sibling. So `timestamp: 1781366050` stays, and `timestamp_human:
 * "15:54:10 - 13/06/26"` is added next to it. The base field remains
 * schema-true; the `_human` view is presentation layered on top.
 */
export function humanizeTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(humanizeTimestamps);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = humanizeTimestamps(v);
      if (
        typeof v === "number" &&
        Number.isInteger(v) &&
        v >= TS_MIN &&
        v <= TS_MAX &&
        isTimestampKey(k)
      ) {
        out[`${k}_human`] = toHuman(v);
      }
    }
    return out;
  }
  return value;
}

/** Build the full Torn request URL from a resolved path, query params, and key. */
export function buildUrl(
  path: string,
  params: Record<string, string | number> | undefined,
  key: string,
): string {
  const url = new URL(`${TORN_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set("key", key);
  return url.toString();
}

/**
 * Ensure a Torn URL carries the API key. Torn strips the key from the
 * `_metadata.links` URLs used for pagination, so follow-up fetches must re-add
 * it. Overwrites any existing key param.
 */
export function ensureKey(url: string, key: string): string {
  const u = new URL(url);
  u.searchParams.set("key", key);
  return u.toString();
}

/**
 * Torn returns errors as `{ "error": { "code": n, "error": "msg" } }`. Detect
 * that so we can surface a clean MCP error. Returns the message, or null when
 * the payload is not an error envelope.
 */
export function parseTornError(jsonText: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    "error" in parsed &&
    typeof (parsed as { error: unknown }).error === "object" &&
    (parsed as { error: unknown }).error !== null
  ) {
    const err = (parsed as { error: { code?: number; error?: string } }).error;
    const code = err.code ?? "?";
    const msg = err.error ?? "unknown error";
    return `Torn API error ${code}: ${msg}`;
  }
  return null;
}

/** SHA-256 hex digest, used to scope rate-limit state by key without storing the key. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
