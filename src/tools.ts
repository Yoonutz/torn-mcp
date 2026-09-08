// @license MIT
// Tool registration for the MCP server, kept free of Worker globals so the
// exact tool list a client receives can be asserted in plain Node (tools.test.ts).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { endpointBadges, paramsHint } from "./torn.js";
import { ENDPOINTS, TAGS, type EndpointDef, type TornTag } from "./generated/endpoints.js";
import { textResult, type ToolResult } from "./mcpResult.js";
import { registerCustomTools } from "./custom/tools.js";
import type { TornCall } from "./custom/services.js";

/**
 * Upper bound for one tool description as serialized to clients. Chosen so the
 * largest grouped tool (user, 69 endpoints) fits with one line per endpoint;
 * anything longer gets cut by clients and the model never sees the tail.
 */
export const MAX_DESCRIPTION_CHARS = 5000;

/** Longest endpoint summary shown inline; the full text lives in discovery. */
const SUMMARY_CHARS = 60;

export interface ToolDeps {
  /** Generated-tool handler: fetch + enrich one endpoint for the per-request key. */
  callTorn: (
    extra: unknown,
    tag: TornTag,
    endpoint: string,
    id: string | undefined,
    params: Record<string, string | number> | undefined,
  ) => Promise<ToolResult>;
  /** Intelligence-tool call factory bound to the per-request key. */
  makeCall: (extra: unknown) => TornCall;
}

function endpointNames(tag: TornTag): [string, ...string[]] {
  return Object.keys(ENDPOINTS[tag]) as [string, ...string[]];
}

function shortSummary(text: string | undefined): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  return s.length > SUMMARY_CHARS ? s.slice(0, SUMMARY_CHARS - 1).trimEnd() + "…" : s;
}

/** Build an authoritative tool description from the spec's real summaries. */
export function describeTag(tag: TornTag): string {
  const map = ENDPOINTS[tag] as Record<string, EndpointDef>;
  const lines = Object.entries(map).map(([name, def]) => {
    // Name the actual path param (e.g. tradeId) so id-scoped endpoints like
    // `trade` read clearly against their list sibling `trades`.
    const idNote = def.requiresId ? ` (requires ${def.idParam?.name ?? "id"})` : "";
    // When the id variant means something else ("your faction" vs "a faction"),
    // flag it: the model picks between them by passing an id. The exact id
    // summary and the id variant's own params live in torn_list_endpoints.
    const idMeaning = def.idSummary ? " [+id]" : "";
    // Return keys are omitted here (they doubled the size of the largest tools)
    // and stay in the discovery catalog.
    return `- ${name}${idNote}: ${shortSummary(def.summary)}${idMeaning}${paramsHint(def)}${endpointBadges(def)}`;
  });
  return (
    `Fetch Torn ${tag} data (Torn API v2). Set 'endpoint' to one of:\n` +
    lines.join("\n") +
    `\n[+id] = pass 'id' to target a specific ${tag} entity instead of your own. ` +
    `Use 'params' for query options; elided enum values (+N more), each endpoint's ` +
    `accepted params and its response fields are in torn_list_endpoints.`
  );
}

/** Register every tool: 9 grouped, 12 intelligence, 1 discovery. */
export function registerAllTools(server: McpServer, deps: ToolDeps): void {
  // Generated layer: one grouped tool per Torn tag.
  for (const tag of TAGS) {
    server.tool(
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
      async ({ endpoint, id, params }, extra) => deps.callTorn(extra, tag, endpoint, id, params),
    );
  }

  // Intelligence layer: each tool binds the per-request key from its `extra`.
  registerCustomTools(server, deps.makeCall);

  // Discovery tool (no key needed).
  server.tool(
    "torn_list_endpoints",
    "Discover Torn endpoints. Pass a 'tag' for that tag's full endpoint " +
      "details (summary, description, accepted query params with every enum value, " +
      "the id variant's own params when they differ, and the response fields each " +
      "endpoint returns). Omit 'tag' for a compact index of every tag and its endpoint names.",
    { tag: z.enum(TAGS).optional().describe("Optional tag to filter by.") },
    async ({ tag }) => {
      if (tag) return textResult(JSON.stringify(ENDPOINTS[tag], null, 2));
      const index = Object.fromEntries(TAGS.map((t) => [t, Object.keys(ENDPOINTS[t])]));
      return textResult(JSON.stringify(index, null, 2));
    },
  );
}
