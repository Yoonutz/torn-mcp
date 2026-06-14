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
