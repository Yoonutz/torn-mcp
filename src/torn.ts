// @license MIT
// Pure helpers for talking to the Torn City API v2. No Worker globals here so
// these stay unit-testable in plain Node.
import {
  ENDPOINTS,
  type EndpointDef,
  type QueryParam,
  type TornTag,
} from "./generated/endpoints.js";

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

/** One numeric id, or a comma-separated list of them (`206` / `206,207`). */
const NUMERIC_LIST = /^\d+(,\d+)*$/;

/** Endpoints whose id is a Torn item TYPE id — an item name may be resolved to it. */
export const ITEM_NAME_ENDPOINTS = new Set(["market/itemmarket", "market/bazaar", "torn/items"]);

/** Endpoints whose id is an item instance UID — never an item name, never resolvable. */
export const ITEM_UID_ENDPOINTS = new Set(["torn/itemdetails", "torn/itemstats"]);

export type ItemIdClass =
  | { kind: "passthrough"; id: string | undefined }
  | { kind: "numeric"; id: string }
  | { kind: "name"; id: string };

/**
 * Decide what an `id` argument means for an item endpoint. Numeric ids and
 * numeric lists pass through untouched; an item name is flagged for name→id
 * resolution on item-type endpoints only. Throws on inputs that can never be
 * valid, so the model gets a precise reason instead of Torn's "Incorrect ID".
 */
export function classifyItemId(tag: string, endpoint: string, id: string | undefined): ItemIdClass {
  const key = `${tag}/${endpoint}`;
  const isItemEndpoint = ITEM_NAME_ENDPOINTS.has(key) || ITEM_UID_ENDPOINTS.has(key);
  if (!id || !isItemEndpoint) return { kind: "passthrough", id };
  if (NUMERIC_LIST.test(id)) return { kind: "numeric", id };
  if (ITEM_UID_ENDPOINTS.has(key)) {
    throw new Error(
      `Endpoint '${endpoint}' takes item uids (numeric, comma-separated), not item names. ` +
        `Item uids come from inventory/market listings (item.uid).`,
    );
  }
  if (id.includes(",")) {
    throw new Error(
      `Comma-separated ids must all be numeric for endpoint '${endpoint}'; ` +
        `an item name can only be given on its own.`,
    );
  }
  return { kind: "name", id };
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
  // return an opaque "Incorrect ID". `array<integer>` ids (`ids`, `categoryIds`)
  // accept a comma-separated numeric list.
  if (id !== undefined && id !== "") {
    const idType = def.idParam?.type ?? "";
    if (idType === "integer" && !/^\d+$/.test(String(id))) {
      return `'${id}' is not a valid id for endpoint '${endpoint}' — it must be a numeric Torn id.`;
    }
    if (idType.startsWith("array<integer") && !NUMERIC_LIST.test(String(id))) {
      return `'${id}' is not a valid id for endpoint '${endpoint}' — it must be a numeric id or a comma-separated list of numeric ids.`;
    }
  }

  // The id variant of an endpoint can carry a different query contract than
  // the plain one (e.g. /torn/{ids}/honors takes no limit/offset). Validate
  // against the variant that will actually be called.
  const withId = id !== undefined && id !== "";
  const query = withId && def.idQuery ? def.idQuery : def.query;
  const accepted = new Set(query.map((q) => q.name));
  for (const name of Object.keys(params)) {
    if (!accepted.has(name)) {
      const scope = withId && def.idQuery ? " when an id is given" : "";
      const list = accepted.size ? [...accepted].join(", ") : "none";
      return `Query param '${name}' is not accepted by endpoint '${endpoint}'${scope}. Accepted: ${list}.`;
    }
  }

  for (const q of query) {
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
/** Enum values shown inline in a tool description; longer lists are elided. */
export const MAX_INLINE_ENUM = 6;

export function paramsHint(def: EndpointDef): string {
  // Short enums are shown whole (the model needs e.g. inventory cat=Drug);
  // long ones are elided and live in full in torn_list_endpoints, so the
  // always-on description stays within client display budgets.
  const fmtEnum = (q: QueryParam): string => {
    const values = q.enum ?? [];
    if (values.length <= MAX_INLINE_ENUM) return `${q.name}=${values.join("|")}`;
    const shown = values.slice(0, MAX_INLINE_ENUM - 1);
    return `${q.name}=${shown.join("|")}|…(+${values.length - shown.length} more)`;
  };
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
 * Compact return hint for a tool description: the top-level response key(s) the
 * endpoint yields, so the model knows the result shape before calling. Nested
 * field names are omitted here (too heavy for always-on descriptions) — they
 * live in the full `returns` catalog via torn_list_endpoints. Selection-based
 * endpoints (oneOf/anyOf body) report "varies by selection".
 */
export function returnsHint(def: EndpointDef): string {
  if (def.selectionBased) return " → returns: varies by selection";
  if (!def.returns || def.returns.length === 0) return "";
  return ` → returns: ${def.returns.map((r) => r.name).join(", ")}`;
}

/**
 * Compact badges for a tool description: the required key level (shown only when
 * above the default `public`) and an unstable-contract warning.
 */
export function endpointBadges(def: EndpointDef): string {
  const badges: string[] = [];
  if (def.keyLevel && def.keyLevel !== "public") badges.push(`[key: ${def.keyLevel}]`);
  if (def.responseType === "csv") badges.push("[csv]");
  if (def.stability === "Unstable") badges.push("⚠ unstable");
  return badges.length ? ` ${badges.join(" ")}` : "";
}

export type BodyFormat = "json" | "csv";

/** Body format an endpoint answers with, per the spec's documented content type. */
export function responseFormat(tag: string, endpoint: string): BodyFormat {
  const def = (ENDPOINTS[tag as TornTag] as Record<string, EndpointDef> | undefined)?.[endpoint];
  return def?.responseType === "csv" ? "csv" : "json";
}

/**
 * Turn a Torn response body into the value a tool returns. Torn signals errors
 * as an HTTP 200 JSON envelope on every endpoint, CSV ones included, so the
 * envelope check runs first. A CSV body is wrapped rather than parsed.
 */
export function parseTornBody(text: string, format: BodyFormat): unknown {
  const tornErr = parseTornError(text);
  if (tornErr) throw new Error(tornErr);
  if (format === "csv") return { csv: text, format: "text/csv" };
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Torn API returned a non-JSON response.");
  }
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
