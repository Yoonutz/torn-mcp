// @license MIT
// Per-request Torn API key extraction. Header only, by design: a key carried in
// the URL would be persisted by Cloudflare invocation logs ("<Method> <URL>"),
// which would break the "never logged" promise in SECURITY.md. The Worker
// therefore never reads the query string for auth, and the DO URL it forwards
// carries no query string at all.
//
// Three header names are accepted, in this order of precedence:
//   1. X-Torn-Api-Key      - the canonical header, used downstream of the Worker.
//   2. X-Api-Key           - for clients that only allow pre-approved header
//                            names (claude.ai custom connectors reject a custom
//                            name such as X-Torn-Api-Key at save time).
//   3. Authorization: Bearer <key> - for clients that only speak bearer auth.
// The Worker normalizes whichever it finds into X-Torn-Api-Key before the
// request reaches the session Durable Object.

/** Lowercase header name (Headers.get is case-insensitive; requestInfo keys are lowercase). */
export const KEY_HEADER = "x-torn-api-key";

/** Generic API-key header accepted as an alternative to KEY_HEADER. */
export const ALT_KEY_HEADER = "x-api-key";

export const MISSING_KEY_ERROR =
  "Missing Torn API key. Send it in the X-Torn-Api-Key request header " +
  "(X-Api-Key and Authorization: Bearer <key> are also accepted).";

/** Extract the token from an `Authorization: Bearer <token>` value, else "". */
function bearerToken(value: string | null): string {
  if (!value) return "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(value);
  return match?.[1] ?? "";
}

/**
 * Resolve the key for a request: X-Torn-Api-Key, else X-Api-Key, else a Bearer
 * Authorization header, else the optional server-level fallback, else ""
 * (callers surface MISSING_KEY_ERROR).
 */
export function keyFromHeaders(headers: Headers, fallback?: string): string {
  const headerKey = headers.get(KEY_HEADER);
  if (headerKey) return headerKey;
  const altKey = headers.get(ALT_KEY_HEADER);
  if (altKey) return altKey;
  const bearer = bearerToken(headers.get("authorization"));
  if (bearer) return bearer;
  return fallback ?? "";
}
