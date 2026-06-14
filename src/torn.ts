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

function isTimestampKey(key: string): boolean {
  return (
    key === "timestamp" ||
    key === "cache_timestamp" ||
    key === "signed_up" ||
    key === "until" ||
    key.endsWith("_at")
  );
}

function toHuman(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().replace(".000Z", "Z");
}

/**
 * Recursively add a human-readable ISO sibling for every epoch-seconds field
 * (keys like `timestamp`, `*_at`, `signed_up`, `until`). The original epoch is
 * kept; a `<key>_human` field is added next to it. Humans can't read epoch.
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
