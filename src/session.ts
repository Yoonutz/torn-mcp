// @license MIT
// Stale-session detection for the per-session Durable Object.
//
// A DO can be evicted or replaced by a deploy at any time. When that happens the
// next request for an existing Mcp-Session-Id lands on a fresh instance with no
// transport. The SDK transport would answer 400 "Server not initialized", which
// MCP clients treat as a hard error; the protocol's recovery path is a 404
// "Session not found", on which clients start a new session (re-initialize).
// So a fresh DO that sees a session id answers 404 itself.

const SESSION_HEADER = "mcp-session-id";

/** True when this DO has no live transport yet the request names a session. */
export function isStaleSessionRequest(hasTransport: boolean, request: Request): boolean {
  if (hasTransport) return false;
  return !!request.headers.get(SESSION_HEADER);
}

/**
 * JSON-RPC 404 that tells the client to re-initialize (mirrors the SDK's own
 * shape). Drains the request body first: the Worker streams the body into the
 * DO, and answering while it is still unread makes the runtime throw "Can't
 * read from request stream after response has been sent" and take the isolate
 * down with it (observed under `wrangler dev`: the next request got a 503).
 */
export async function staleSessionResponse(request: Request): Promise<Response> {
  try {
    await request.arrayBuffer();
  } catch {
    /* body already consumed or absent — nothing to drain */
  }
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found: the session expired, start a new one" },
      id: null,
    }),
    { status: 404, headers: { "content-type": "application/json" } },
  );
}

/**
 * The Worker answers GET /mcp itself with 405, which the Streamable HTTP spec
 * allows ("the server does not offer an SSE stream at this endpoint"), and the
 * SDK client treats as expected. Forwarding GET let the transport open a
 * standalone SSE stream that stays open for the whole client session, keeping
 * the session DO awake and billed for Durable Object duration while idle. No
 * tool sends server-initiated messages; progress and results ride the POST
 * response, so nothing is lost. Returns null for every other method.
 */
export function standaloneSseRejection(request: Request): Response | null {
  if (request.method !== "GET") return null;
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed: this server does not offer a standalone SSE stream" },
      id: null,
    }),
    { status: 405, headers: { Allow: "POST, DELETE", "content-type": "application/json" } },
  );
}
