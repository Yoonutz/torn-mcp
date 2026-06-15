// @license MIT
// Pure helpers for talking to the Torn City API v2. No Worker globals here so
// these stay unit-testable in plain Node.
import { ENDPOINTS, type EndpointDef, type TornTag } from "./generated/endpoints.js";

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
): string | null {
  const tagMap = ENDPOINTS[tag as TornTag] as
    | Record<string, EndpointDef>
    | undefined;
  const def = tagMap?.[endpoint];
  if (!def) return null; // unknown endpoint handled by resolveEndpointPath
  for (const q of def.query) {
    const val = params[q.name];
    const missing = val === undefined || val === "";
    if (q.required && missing) {
      const allowed = q.enum ? ` (one of: ${q.enum.join(", ")})` : "";
      return `Endpoint '${endpoint}' requires query param '${q.name}'${allowed}.`;
    }
    if (!missing && q.enum && !q.enum.includes(String(val))) {
      return `Invalid '${q.name}'='${val}' for endpoint '${endpoint}'. Allowed: ${q.enum.join(", ")}.`;
    }
  }
  return null;
}

/** Required query params for an endpoint, formatted for a tool description. */
export function requiredParamsHint(def: EndpointDef): string {
  const reqs = def.query.filter((q) => q.required);
  if (reqs.length === 0) return "";
  const parts = reqs.map((q) => {
    if (!q.enum) return q.name;
    const vals = q.enum.slice(0, 10).join("|");
    return `${q.name}=${vals}${q.enum.length > 10 ? "|…" : ""}`;
  });
  return ` · requires ${parts.join(", ")}`;
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
 * Recursively rewrite every epoch-seconds field (keys like `timestamp`, `*_at`,
 * `signed_up`, `until`) to Torn City Time, and move the raw epoch to a
 * `<key>_epoch` sibling. So `timestamp: 1781366050` becomes
 * `timestamp: "15:54:10 - 13/06/26"` + `timestamp_epoch: 1781366050`.
 */
export function humanizeTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(humanizeTimestamps);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof v === "number" &&
        Number.isInteger(v) &&
        v >= TS_MIN &&
        v <= TS_MAX &&
        isTimestampKey(k)
      ) {
        out[k] = toHuman(v);
        out[`${k}_epoch`] = v;
      } else {
        out[k] = humanizeTimestamps(v);
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
