// @license MIT
// Per-request Torn API key extraction. Header only, by design: a key carried in
// the URL would be persisted by Cloudflare invocation logs ("<Method> <URL>"),
// which would break the "never logged" promise in SECURITY.md. The Worker
// therefore never reads the query string for auth, and the DO URL it forwards
// carries no query string at all.

/** Lowercase header name (Headers.get is case-insensitive; requestInfo keys are lowercase). */
export const KEY_HEADER = "x-torn-api-key";

export const MISSING_KEY_ERROR =
  "Missing Torn API key. Send it in the X-Torn-Api-Key request header.";

/**
 * Resolve the key for a request: the header when present and non-empty, else the
 * optional server-level fallback, else "" (callers surface MISSING_KEY_ERROR).
 */
export function keyFromHeaders(headers: Headers, fallback?: string): string {
  const headerKey = headers.get(KEY_HEADER);
  if (headerKey) return headerKey;
  return fallback ?? "";
}
