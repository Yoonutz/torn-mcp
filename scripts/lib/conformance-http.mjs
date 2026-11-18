// @license MIT
// Torn HTTP for the conformance harness: fixed host, a per-call timeout, HTTP
// status and non-JSON bodies reported plainly, and errors that never carry the key.

/** Torn's `comment` param: shows these calls in the test key's API log. */
export const CONFORMANCE_COMMENT = "torn-mcp-conformance";

/** A Torn call slower than this is aborted and reported as a skip. */
export const DEFAULT_TIMEOUT_MS = 15_000;

export function buildTornUrl(path, params, key) {
  const u = new URL(`https://api.torn.com/v2${path}`);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, String(v));
  if (!u.searchParams.has("comment")) u.searchParams.set("comment", CONFORMANCE_COMMENT);
  u.searchParams.set("key", key);
  return u.toString();
}

/** Remove any `key=` value from text before it lands in a report or log. */
function scrub(text) {
  return String(text).replace(/([?&]key=)[^&\s"']+/gi, "$1***");
}

/**
 * GET one Torn URL. Returns { json, err, status }: `err` is set for a Torn error
 * envelope, an HTTP error, a non-JSON body, a timeout or a network failure.
 */
export async function fetchTornJson(url, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { "User-Agent": "torn-mcp-conformance" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    return { err: timedOut ? `timed out after ${timeoutMs / 1000}s` : scrub(e?.message ?? "network error") };
  }
  const status = res.status;
  let text;
  try {
    text = await res.text();
  } catch (e) {
    return { status, err: scrub(e?.message ?? "could not read the body") };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { status, err: status >= 200 && status < 300 ? `non-JSON response (HTTP ${status})` : `HTTP ${status}` };
  }
  if (json && json.error) return { json, status, err: `Torn ${json.error.code}: ${json.error.error}` };
  if (status < 200 || status >= 300) return { json, status, err: `HTTP ${status}` };
  return { json, status };
}
