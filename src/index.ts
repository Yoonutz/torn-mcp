// @license MIT
import { DurableObject } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  buildUrl,
  ensureKey,
  parseTornError,
  requiredParamsHint,
  resolveEndpointPath,
  sha256Hex,
  validateParams,
} from "./torn.js";
import {
  annotate,
  filterByTimeWindow,
  followPages,
  isEmptyPayload,
  resolveTimeParams,
  truncate,
  WINDOW_NOTE,
  MAX_ITEMS,
  MAX_BYTES,
  MAX_PAGES,
} from "./enrich.js";
import { ENDPOINTS, TAGS, type EndpointDef, type TornTag } from "./generated/endpoints.js";
import { RateLimiter, LIMIT, type RateCheck } from "./rateLimiter.js";
import { errorResult, textResult, type ToolResult } from "./mcpResult.js";
import { registerCustomTools } from "./custom/tools.js";

export { RateLimiter };

/** Server version, surfaced in the MCP display name and serverInfo. */
const VERSION = "0.3.0";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  /** Optional fallback key, used only when the request omits the header. */
  TORN_API_KEY?: string;
}

/**
 * Read the Torn API key from the per-request headers (the SDK passes them on
 * `extra.requestInfo.headers`), falling back to the env key. Headers are
 * lowercased; values may be string or string[].
 */
function keyFromExtra(extra: unknown, env: Env): string {
  const headers = (extra as { requestInfo?: { headers?: Record<string, unknown> } })
    ?.requestInfo?.headers;
  const raw = headers?.["x-torn-api-key"];
  const key = typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0]) : undefined;
  return key ?? env.TORN_API_KEY ?? "";
}

function endpointNames(tag: TornTag): [string, ...string[]] {
  return Object.keys(ENDPOINTS[tag]) as [string, ...string[]];
}

/** Build an authoritative tool description from the spec's real summaries. */
function describeTag(tag: TornTag): string {
  const map = ENDPOINTS[tag] as Record<string, EndpointDef>;
  const lines = Object.entries(map).map(([name, def]) => {
    const summary = (def.summary ?? "").replace(/\s+/g, " ").slice(0, 90);
    const idNote = def.requiresId ? " (requires id)" : "";
    return `- ${name}${idNote}: ${summary}${requiredParamsHint(def)}`;
  });
  return (
    `Fetch Torn ${tag} data (Torn API v2). Set 'endpoint' to one of:\n` +
    lines.join("\n") +
    `\nProvide 'id' for id-scoped endpoints. Use 'params' for query options ` +
    `(call torn_list_endpoints with this tag to see each endpoint's accepted params).`
  );
}

/**
 * One MCP session per Durable Object instance. Owns an McpServer plus the SDK's
 * Workers-native Streamable HTTP transport; the Worker routes each session
 * (by Mcp-Session-Id) to the same DO.
 */
export class TornMCP extends DurableObject<Env> {
  private mcp: McpServer;
  private transport: WebStandardStreamableHTTPServerTransport | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.mcp = new McpServer({ name: `Torn MCP v${VERSION}`, version: VERSION });
    this.registerTools();
  }

  async fetch(request: Request): Promise<Response> {
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

  private registerTools(): void {
    // Generated layer: one grouped tool per Torn tag.
    for (const tag of TAGS) {
      this.mcp.tool(
        `torn_${tag}`,
        describeTag(tag),
        {
          endpoint: z.enum(endpointNames(tag)).describe(`The ${tag} data type to fetch.`),
          id: z.string().optional().describe("Optional entity id (player/faction/item/etc.)."),
          params: z
            .record(z.union([z.string(), z.number()]))
            .optional()
            .describe("Optional extra query parameters."),
        },
        async ({ endpoint, id, params }, extra) =>
          this.callTorn(keyFromExtra(extra, this.env), tag, endpoint, id, params),
      );
    }

    // Intelligence layer: each tool binds the per-request key from its `extra`.
    registerCustomTools(this.mcp, (extra: unknown) => {
      const apiKey = keyFromExtra(extra, this.env);
      return (tag, endpoint, id, params) => this.call(apiKey, tag, endpoint, id, params);
    });

    // Discovery tool (no key needed).
    this.mcp.tool(
      "torn_list_endpoints",
      "Discover Torn endpoints. Pass a 'tag' for that tag's full endpoint " +
        "details (summary, description, accepted query params). Omit 'tag' for " +
        "a compact index of every tag and its endpoint names.",
      { tag: z.enum(TAGS).optional().describe("Optional tag to filter by.") },
      async ({ tag }) => {
        if (tag) return textResult(JSON.stringify(ENDPOINTS[tag], null, 2));
        const index = Object.fromEntries(TAGS.map((t) => [t, Object.keys(ENDPOINTS[t])]));
        return textResult(JSON.stringify(index, null, 2));
      },
    );
  }

  /** Resolve + fetch (paginated, merged) parsed JSON for services. Throws on error. */
  private async call(
    apiKey: string,
    tag: string,
    endpoint: string,
    id?: string,
    params?: Record<string, string | number>,
  ): Promise<any> {
    const path = resolveEndpointPath(tag, endpoint, id);
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
      path = resolveEndpointPath(tag, endpoint, id);
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : "Invalid endpoint.");
    }
    const resolved = resolveTimeParams(params, Date.now());
    const paramErr = validateParams(tag, endpoint, resolved);
    if (paramErr) return errorResult(paramErr);

    const fetched = await this.fetchMerged(apiKey, path, resolved);
    if (!fetched.ok) return errorResult(fetched.error);

    let result: any = filterByTimeWindow(fetched.data, { from: resolved.from, to: resolved.to });

    // Empty-window re-fetch: window set but nothing came back → widen once.
    const hasWindow = resolved.from !== undefined || resolved.to !== undefined;
    if (hasWindow && isEmptyPayload(result)) {
      const widened: Record<string, string | number> = { ...resolved };
      delete widened.from;
      delete widened.to;
      const refetched = await this.fetchMerged(apiKey, path, widened);
      if (refetched.ok && !isEmptyPayload(refetched.data)) {
        result = refetched.data;
        result._note = WINDOW_NOTE;
      }
    }

    result = annotate(tag, endpoint, result);
    result = truncate(result, { maxItems: MAX_ITEMS, maxBytes: MAX_BYTES });
    if (fetched.partial) result._pages_partial = "Stopped paginating early; partial data.";
    return textResult(JSON.stringify(result, null, 2));
  }

  /**
   * Fetch one absolute Torn URL: per-key rate-limit, transient retry, parse.
   * Re-attaches the key (follow links omit it). Throws on any error — the key
   * never appears in the message.
   */
  private async rateLimitedFetch(apiKey: string, url: string): Promise<any> {
    if (!apiKey) {
      throw new Error("Missing Torn API key. Send it in the X-Torn-Api-Key request header.");
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
    const tornErr = parseTornError(text);
    if (tornErr) throw new Error(tornErr);
    if (!res.ok) throw new Error(`Torn API returned HTTP ${res.status}.`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Torn API returned a non-JSON response.");
    }
  }

  /**
   * Shared fetch core: resolve relative time, fetch page 1, follow pagination,
   * return merged JSON.
   */
  private async fetchMerged(
    apiKey: string,
    path: string,
    params: Record<string, string | number> | undefined,
  ): Promise<{ ok: true; data: any; partial: boolean } | { ok: false; error: string }> {
    if (!apiKey) {
      return {
        ok: false,
        error: "Missing Torn API key. Send it in the X-Torn-Api-Key request header.",
      };
    }
    const resolved = resolveTimeParams(params, Date.now());
    const firstUrl = buildUrl(path, resolved, apiKey);
    const fetchUrl = (url: string) => this.rateLimitedFetch(apiKey, url);
    let firstPage: any;
    try {
      firstPage = await fetchUrl(firstUrl);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Torn request failed." };
    }
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
      return stub.fetch(new Request(request, { headers }));
    }

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/version") {
      return new Response(JSON.stringify({ name: "torn-mcp", version: VERSION }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
