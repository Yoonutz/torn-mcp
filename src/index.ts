// @license MIT
import { DurableObject } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  buildUrl,
  classifyItemId,
  ensureKey,
  parseTornBody,
  parseTornError,
  resolveEndpointPath,
  responseFormat,
  sha256Hex,
  validateParams,
  type BodyFormat,
} from "./torn.js";
import {
  annotate,
  filterByTimeWindow,
  followPages,
  isEmptyPayload,
  resolveTimeParams,
  WINDOW_NOTE,
  MAX_PAGES,
} from "./enrich.js";
import { type TornTag } from "./generated/endpoints.js";
import { MANIFEST } from "./generated/manifest.js";
import { RateLimiter, LIMIT, type RateCheck } from "./rateLimiter.js";
import { dualResult, errorResult, type ToolResult } from "./mcpResult.js";
import { registerAllTools } from "./tools.js";
import { KEY_HEADER, MISSING_KEY_ERROR, keyFromHeaders } from "./auth.js";
import { isStaleSessionRequest, staleSessionResponse } from "./session.js";

export { RateLimiter };

/** Server version, surfaced in the MCP display name and serverInfo. */
const VERSION = "0.11.0";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  /** Optional fallback key, used only when the request omits the header. */
  TORN_API_KEY?: string;
}

/**
 * Read the Torn API key from per-request headers (already normalized by the
 * Worker fetch handler and propagated through the DO boundary).
 */
function keyFromExtra(extra: unknown, env: Env): string {
  const headers = (extra as { requestInfo?: { headers?: Record<string, unknown> } })
    ?.requestInfo?.headers;
  const raw = headers?.[KEY_HEADER];
  const key = typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0]) : undefined;
  return key || env.TORN_API_KEY || "";
}

/**
 * One MCP session per Durable Object instance. Owns an McpServer plus the SDK's
 * Workers-native Streamable HTTP transport; the Worker routes each session
 * (by Mcp-Session-Id) to the same DO.
 */
export class TornMCP extends DurableObject<Env> {
  private mcp: McpServer;
  private transport: WebStandardStreamableHTTPServerTransport | null = null;
  /** Cached lowercase item-name → id map, built lazily from /torn/items. */
  private itemMap: Map<string, string> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.mcp = new McpServer({ name: `Torn MCP v${VERSION}`, version: VERSION });
    registerAllTools(this.mcp, {
      callTorn: (extra, tag, endpoint, id, params) =>
        this.callTorn(keyFromExtra(extra, this.env), tag, endpoint, id, params),
      makeCall: (extra) => {
        const apiKey = keyFromExtra(extra, this.env);
        return (tag, endpoint, id, params) => this.call(apiKey, tag, endpoint, id, params);
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    // A request naming a session that this (fresh) instance does not hold means
    // the DO was evicted or redeployed: answer 404 so the client re-initializes
    // instead of the SDK's 400 "Server not initialized", which clients treat as fatal.
    if (isStaleSessionRequest(this.transport !== null, request)) {
      return staleSessionResponse(request);
    }
    if (!this.transport) {
      // The Worker supplies this session's id (X-DO-Session); the transport
      // echoes it back to the client as Mcp-Session-Id.
      const sessionId = request.headers.get("X-DO-Session") ?? crypto.randomUUID();
      this.transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });
      await this.mcp.connect(this.transport);
    }
    return this.transport.handleRequest(request);
  }

  /** Lazily build a lowercase item-name → id map from the full /torn/items list. */
  private async itemNameToId(apiKey: string): Promise<Map<string, string>> {
    if (this.itemMap) return this.itemMap;
    const res = await this.fetchMerged(apiKey, "/torn/items", {});
    if (!res.ok) throw new Error(res.error);
    const map = new Map<string, string>();
    for (const it of (res.data?.items as any[]) ?? []) {
      if (it && it.name != null && it.id != null) {
        map.set(String(it.name).toLowerCase(), String(it.id));
      }
    }
    this.itemMap = map;
    return map;
  }

  /**
   * For item-type endpoints, resolve an item name to its numeric id via
   * /torn/items. Numeric ids, numeric id lists and non-item endpoints pass
   * through; uid endpoints and mixed lists are rejected by classifyItemId.
   */
  private async resolveItemName(
    apiKey: string,
    tag: string,
    endpoint: string,
    id: string | undefined,
  ): Promise<string | undefined> {
    const cls = classifyItemId(tag, endpoint, id);
    if (cls.kind !== "name") return cls.id;
    const hit = (await this.itemNameToId(apiKey)).get(cls.id.toLowerCase());
    if (!hit) {
      throw new Error(`No Torn item named '${cls.id}'. Use the exact item name or a numeric item id.`);
    }
    return hit;
  }

  /** Resolve + fetch (paginated, merged) parsed JSON for services. Throws on error. */
  private async call(
    apiKey: string,
    tag: string,
    endpoint: string,
    id?: string,
    params?: Record<string, string | number>,
  ): Promise<any> {
    const resolvedId = await this.resolveItemName(apiKey, tag, endpoint, id);
    const path = resolveEndpointPath(tag, endpoint, resolvedId);
    const fetched = await this.fetchMerged(apiKey, path, params);
    if (!fetched.ok) throw new Error(fetched.error);
    return fetched.data;
  }

  /** Generated-tool handler: fetch merged JSON, then filter/annotate/truncate. */
  private async callTorn(
    apiKey: string,
    tag: TornTag,
    endpoint: string,
    id: string | undefined,
    params: Record<string, string | number> | undefined,
  ): Promise<ToolResult> {
    let path: string;
    try {
      id = await this.resolveItemName(apiKey, tag, endpoint, id);
      path = resolveEndpointPath(tag, endpoint, id);
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : "Invalid endpoint.");
    }
    const resolved = resolveTimeParams(params, Date.now());
    const paramErr = validateParams(tag, endpoint, resolved, id);
    if (paramErr) return errorResult(paramErr);

    const format = responseFormat(tag, endpoint);
    const fetched = await this.fetchMerged(apiKey, path, resolved, format);
    if (!fetched.ok) return errorResult(fetched.error);
    // CSV endpoints (snapshots): no pagination, no enrichment — hand back the
    // text as-is with the canonical wrapper in the structured channel.
    if (format === "csv") return dualResult(fetched.data, String(fetched.data?.csv ?? ""));

    // Canonical data (close to the schema): merged + window-filtered Torn data.
    let canonical: any = filterByTimeWindow(fetched.data, { from: resolved.from, to: resolved.to });

    // Empty-window re-fetch: window set but nothing came back → widen once.
    const hasWindow = resolved.from !== undefined || resolved.to !== undefined;
    if (hasWindow && isEmptyPayload(canonical)) {
      const widened: Record<string, string | number> = { ...resolved };
      delete widened.from;
      delete widened.to;
      const refetched = await this.fetchMerged(apiKey, path, widened);
      if (refetched.ok && !isEmptyPayload(refetched.data)) {
        canonical = refetched.data;
        canonical._note = WINDOW_NOTE;
      }
    }
    if (fetched.partial) {
      canonical._pages_partial =
        `Stopped after ${MAX_PAGES} pages (subrequest limit). More data may exist — ` +
        `narrow with from/to or a category filter, or page via _metadata.links.next.`;
    }

    // Presentation channel: humanized + computed annotations over the canonical.
    const enriched = annotate(tag, endpoint, canonical);
    return dualResult(canonical, JSON.stringify(enriched, null, 2));
  }

  /**
   * Fetch one absolute Torn URL: per-key rate-limit, transient retry, parse.
   * Re-attaches the key (follow links omit it). Throws on any error — the key
   * never appears in the message.
   */
  private async rateLimitedFetch(apiKey: string, url: string, format: BodyFormat = "json"): Promise<any> {
    if (!apiKey) {
      throw new Error(MISSING_KEY_ERROR);
    }

    const keyHash = await sha256Hex(apiKey);
    const stub = this.env.RATE_LIMITER.get(this.env.RATE_LIMITER.idFromName(keyHash));
    const check = await stub.fetch("https://rate-limiter/check");
    const rc = (await check.json()) as RateCheck;
    if (rc.limited) {
      throw new Error(
        `Rate limit exceeded (~${LIMIT}/min per key). Retry in ${Math.ceil(rc.resetMs / 1000)}s.`,
      );
    }

    // SSRF / key-exfil guard: follow URLs come from Torn's _metadata.links, but
    // the key must never be sent anywhere except the fixed Torn host.
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      throw new Error("Refusing to fetch a malformed Torn URL.");
    }
    if (host !== "api.torn.com") {
      throw new Error("Refusing to send the API key to a non-Torn host.");
    }

    const withKey = ensureKey(url, apiKey);
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch(withKey, { headers: { "User-Agent": "torn-mcp" } });
      } catch {
        if (attempt === 2) throw new Error("Network error contacting the Torn API.");
        await sleep(400 * Math.pow(2, attempt));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 2) break;
        await sleep(400 * Math.pow(2, attempt));
        continue;
      }
      break;
    }
    if (!res) throw new Error("Network error contacting the Torn API.");

    const text = await res.text();
    if (!res.ok) {
      throw new Error(parseTornError(text) ?? `Torn API returned HTTP ${res.status}.`);
    }
    // Torn signals errors as HTTP 200 + `{ error }` on every endpoint; parseTornBody
    // checks that first, then parses JSON or wraps CSV per the spec's content type.
    return parseTornBody(text, format);
  }

  /**
   * Shared fetch core: resolve relative time, fetch page 1, follow pagination,
   * return merged JSON.
   */
  private async fetchMerged(
    apiKey: string,
    path: string,
    params: Record<string, string | number> | undefined,
    format: BodyFormat = "json",
  ): Promise<{ ok: true; data: any; partial: boolean } | { ok: false; error: string }> {
    if (!apiKey) {
      return {
        ok: false,
        error: MISSING_KEY_ERROR,
      };
    }
    const resolved = resolveTimeParams(params, Date.now());
    const firstUrl = buildUrl(path, resolved, apiKey);
    const fetchUrl = (url: string) => this.rateLimitedFetch(apiKey, url, format);
    let firstPage: any;
    try {
      firstPage = await fetchUrl(firstUrl);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Torn request failed." };
    }
    if (format === "csv") return { ok: true, data: firstPage, partial: false };
    const { merged, partial } = await followPages(firstPage, fetchUrl, MAX_PAGES);
    return { ok: true, data: merged, partial };
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      // Sticky-route each MCP session to its own Durable Object.
      const sessionId = request.headers.get("Mcp-Session-Id") ?? crypto.randomUUID();
      const stub = env.MCP_OBJECT.get(env.MCP_OBJECT.idFromName(sessionId));
      const headers = new Headers(request.headers);
      headers.set("X-DO-Session", sessionId);

      // Auth is header-only (see auth.ts). Normalize once at ingress so every
      // downstream tool invocation reads the same header; the query string is
      // deliberately NOT forwarded, so nothing placed there can be used or seen
      // past this point.
      const apiKey = keyFromHeaders(request.headers, env.TORN_API_KEY);
      if (apiKey) headers.set("X-Torn-Api-Key", apiKey);

      return stub.fetch(
        new Request("https://mcp-session/mcp", {
          method: request.method,
          headers,
          body: request.body,
          redirect: request.redirect,
        }),
      );
    }

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/version") {
      return new Response(
        JSON.stringify({
          name: "torn-mcp",
          server: VERSION,
          openapi: MANIFEST.openapiVersion,
          specHash: MANIFEST.specHash,
          endpoints: MANIFEST.endpoints,
          rawOperations: MANIFEST.rawOperations,
          tags: MANIFEST.tags,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
