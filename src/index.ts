// @license MIT
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  /** Optional fallback key, used only when the request omits the header. */
  TORN_API_KEY?: string;
}

/** Per-request props injected by the fetch handler from the header. */
interface Props {
  apiKey: string;
  [key: string]: unknown;
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

export class TornMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({ name: "torn-mcp", version: "0.1.0" });

  async init(): Promise<void> {
    // Generated layer: one grouped tool per Torn tag.
    for (const tag of TAGS) {
      this.server.tool(
        `torn_${tag}`,
        describeTag(tag),
        {
          endpoint: z
            .enum(endpointNames(tag))
            .describe(`The ${tag} data type to fetch.`),
          id: z
            .string()
            .optional()
            .describe("Optional entity id (player/faction/item/etc.)."),
          params: z
            .record(z.union([z.string(), z.number()]))
            .optional()
            .describe("Optional extra query parameters."),
        },
        async ({ endpoint, id, params }) =>
          this.callTorn(tag, endpoint, id, params),
      );
    }

    // Intelligence layer: 12 aggregation tools sharing the same fetch core.
    registerCustomTools(this.server, (tag, endpoint, id, params) =>
      this.call(tag, endpoint, id, params),
    );

    // Discovery tool. With a tag: full per-endpoint metadata; without: a
    // compact index of every tag and its endpoint names.
    this.server.tool(
      "torn_list_endpoints",
      "Discover Torn endpoints. Pass a 'tag' for that tag's full endpoint " +
        "details (summary, description, accepted query params). Omit 'tag' for " +
        "a compact index of every tag and its endpoint names.",
      { tag: z.enum(TAGS).optional().describe("Optional tag to filter by.") },
      async ({ tag }) => {
        if (tag) return textResult(JSON.stringify(ENDPOINTS[tag], null, 2));
        const index = Object.fromEntries(
          TAGS.map((t) => [t, Object.keys(ENDPOINTS[t])]),
        );
        return textResult(JSON.stringify(index, null, 2));
      },
    );
  }

  /** Resolve + fetch (paginated, merged) parsed JSON for services. Throws on error. */
  private async call(
    tag: string,
    endpoint: string,
    id?: string,
    params?: Record<string, string | number>,
  ): Promise<any> {
    const path = resolveEndpointPath(tag, endpoint, id);
    const fetched = await this.fetchMerged(path, params);
    if (!fetched.ok) throw new Error(fetched.error);
    return fetched.data;
  }

  /** Generated-tool handler: fetch merged JSON, then filter/annotate/truncate. */
  private async callTorn(
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

    const fetched = await this.fetchMerged(path, resolved);
    if (!fetched.ok) return errorResult(fetched.error);

    let result: any = filterByTimeWindow(fetched.data, { from: resolved.from, to: resolved.to });

    // Empty-window re-fetch: window set but nothing came back → widen once.
    // Note: this fallback re-runs pagination, costing up to MAX_PAGES extra requests.
    const hasWindow = resolved.from !== undefined || resolved.to !== undefined;
    if (hasWindow && isEmptyPayload(result)) {
      const widened: Record<string, string | number> = { ...resolved };
      delete widened.from;
      delete widened.to;
      const refetched = await this.fetchMerged(path, widened);
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
   * Fetch one absolute Torn URL: per-key rate-limit, transient retry (Torn
   * throws intermittent 504s), parse. Re-attaches the key (follow links omit
   * it). Throws on any error — the key never appears in the message.
   */
  private async rateLimitedFetch(url: string): Promise<any> {
    const apiKey = this.props.apiKey;
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
   * Shared fetch core for raw tools and intelligence services: resolve relative
   * time, fetch page 1, follow pagination, return merged JSON. Relative-time
   * resolution is idempotent, so callTorn may also resolve beforehand.
   */
  private async fetchMerged(
    path: string,
    params: Record<string, string | number> | undefined,
  ): Promise<{ ok: true; data: any; partial: boolean } | { ok: false; error: string }> {
    if (!this.props.apiKey) {
      return {
        ok: false,
        error: "Missing Torn API key. Send it in the X-Torn-Api-Key request header.",
      };
    }
    const resolved = resolveTimeParams(params, Date.now());
    const firstUrl = buildUrl(path, resolved, this.props.apiKey);
    const fetchUrl = (url: string) => this.rateLimitedFetch(url);
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
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      const apiKey =
        request.headers.get("X-Torn-Api-Key") ?? env.TORN_API_KEY ?? "";
      // Pass the key to the agent out-of-band so it never becomes a tool param.
      (ctx as ExecutionContext & { props: Props }).props = { apiKey };
      return TornMCP.serve("/mcp").fetch(request, env, ctx);
    }

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};
