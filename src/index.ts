// @license MIT
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildUrl,
  humanizeTimestamps,
  parseTornError,
  requiredParamsHint,
  resolveEndpointPath,
  sha256Hex,
  validateParams,
} from "./torn.js";
import { ENDPOINTS, TAGS, type EndpointDef, type TornTag } from "./generated/endpoints.js";
import { RateLimiter, LIMIT, type RateCheck } from "./rateLimiter.js";
import { errorResult, textResult, type ToolResult } from "./mcpResult.js";
import { registerCustomTools } from "./custom/tools.js";

export { RateLimiter };

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

type TornGet =
  | { ok: true; text: string; json: any }
  | { ok: false; error: string };

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

  /** Resolve + fetch, returning parsed JSON. Throws on any error (for services). */
  private async call(
    tag: string,
    endpoint: string,
    id?: string,
    params?: Record<string, string | number>,
  ): Promise<any> {
    const path = resolveEndpointPath(tag, endpoint, id);
    const r = await this.tornGet(path, params);
    if (!r.ok) throw new Error(r.error);
    return r.json;
  }

  /** Generated-tool handler: resolve path, fetch, return raw JSON text. */
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
    // Validate params against the catalog before spending a Torn request.
    const paramErr = validateParams(tag, endpoint, params ?? {});
    if (paramErr) return errorResult(paramErr);

    const r = await this.tornGet(path, params);
    if (!r.ok) return errorResult(r.error);
    // Add human-readable timestamps; fall back to raw text if JSON didn't parse.
    return r.json !== null
      ? textResult(JSON.stringify(humanizeTimestamps(r.json), null, 2))
      : textResult(r.text);
  }

  /** Shared fetch core: auth check, per-key rate limit, fetch, error mapping. */
  private async tornGet(
    path: string,
    params: Record<string, string | number> | undefined,
  ): Promise<TornGet> {
    const apiKey = this.props.apiKey;
    if (!apiKey) {
      return {
        ok: false,
        error:
          "Missing Torn API key. Send it in the X-Torn-Api-Key request header.",
      };
    }

    // Per-key rate limiting via Durable Object.
    const keyHash = await sha256Hex(apiKey);
    const stub = this.env.RATE_LIMITER.get(
      this.env.RATE_LIMITER.idFromName(keyHash),
    );
    const check = await stub.fetch("https://rate-limiter/check");
    const rc = (await check.json()) as RateCheck;
    if (rc.limited) {
      return {
        ok: false,
        error:
          `Rate limit exceeded (~${LIMIT}/min per key). Retry in ` +
          `${Math.ceil(rc.resetMs / 1000)}s.`,
      };
    }

    const url = buildUrl(path, params, apiKey);
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": "torn-mcp" } });
    } catch {
      // Never include the URL — it contains the key.
      return { ok: false, error: "Network error contacting the Torn API." };
    }

    const text = await res.text();
    const tornErr = parseTornError(text);
    if (tornErr) return { ok: false, error: tornErr };
    if (!res.ok) return { ok: false, error: `Torn API returned HTTP ${res.status}.` };

    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Leave json null; raw text is still returned for generated tools.
    }
    return { ok: true, text, json };
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
