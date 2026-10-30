// @license MIT
// Tool registration for the MCP server, kept free of Worker globals so the
// exact tool list a client receives can be asserted in plain Node (tools.test.ts).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { endpointBadges, paramsHint } from "./torn.js";
import { ENDPOINTS, TAGS, type EndpointDef, type TornTag } from "./generated/endpoints.js";
import { textResult, type ToolResult } from "./mcpResult.js";
import { registerCustomTools } from "./custom/tools.js";
import { readOnly } from "./annotations.js";
import type { TornCall } from "./custom/services.js";

/**
 * Upper bound for one tool description as serialized to clients. The Claude
 * connector directory shows about 4000 characters, so the largest grouped tool
 * (user, 69 endpoints) must fit that with one line per endpoint; anything longer
 * gets cut and the reader never sees the tail.
 */
export const MAX_DESCRIPTION_CHARS = 4000;

/**
 * Enum hints repeated on many endpoints. Each line names only the param and the
 * legend spells out its values once.
 */
const COMMON_ENUMS: Record<string, string> = {
  sort: "DESC|ASC",
  striptags: "true|false",
  filters: "incoming|outgoing|idFilter",
};

/** Display titles for the grouped tools, e.g. torn_user -> "Torn User Data". */
function tagTitle(tag: TornTag): string {
  return tag === "torn" ? "Torn City Data" : `Torn ${tag.charAt(0).toUpperCase()}${tag.slice(1)} Data`;
}

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
  // The header already says "Fetch" and that data is your own by default, so
  // the spec's leading "Get your" and a trailing "information" carry nothing.
  const s = (text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^Get (?:your |my )?(\w)/, (_, c: string) => c.toUpperCase())
    .replace(/ information$/, "");
  return s.length > SUMMARY_CHARS ? s.slice(0, SUMMARY_CHARS - 1).trimEnd() + "…" : s;
}

/** Build an authoritative tool description from the spec's real summaries. */
export function describeTag(tag: TornTag): string {
  const map = ENDPOINTS[tag] as Record<string, EndpointDef>;
  const usedEnums = new Set<string>();
  let usesKeyLevel = false;
  const lines = Object.entries(map).map(([name, def]) => {
    // Name the actual path param (e.g. tradeId) so id-scoped endpoints like
    // `trade` read clearly against their list sibling `trades`.
    const idNote = def.requiresId ? ` (requires ${def.idParam?.name ?? "id"})` : "";
    // When the id variant means something else ("your faction" vs "a faction"),
    // flag it: the model picks between them by passing an id. The exact id
    // summary and the id variant's own params live in the discovery catalog.
    // Descriptions never name another tool (connector directory policy).
    const idMeaning = def.idSummary ? " [+id]" : "";
    // Return keys are omitted here (they doubled the size of the largest tools)
    // and stay in the discovery catalog.
    let hint = paramsHint(def);
    for (const [param, values] of Object.entries(COMMON_ENUMS)) {
      const full = `${param}=${values}`;
      if (hint.includes(full)) usedEnums.add(param);
      hint = hint.replace(full, param);
    }
    // "[key: limited]" -> "[limited]"; the legend says what the tag means.
    const badges = endpointBadges(def).replace("[key: ", "[");
    if (badges !== endpointBadges(def)) usesKeyLevel = true;
    return `- ${name}${idNote}: ${shortSummary(def.summary)}${idMeaning}${hint}${badges}`;
  });
  const enumLegend = [...usedEnums].map((p) => `${p}=${COMMON_ENUMS[p]}`).join(", ");
  return (
    `Fetch Torn ${tag} data (Torn API v2), your own unless an id is passed. ` +
    `Set 'endpoint' to one of:\n` +
    lines.join("\n") +
    `\n[+id] = pass 'id' to target a specific ${tag} entity instead of your own. ` +
    (usesKeyLevel ? `[minimal]/[limited]/[full] = API key access level needed. ` : "") +
    `Use 'params' for query options${enumLegend ? ` (${enumLegend})` : ""}. ` +
    `(+N more) = further accepted values not listed here.`
  );
}

/** Register every tool: 9 grouped, 12 intelligence, 1 discovery. All are read-only. */
export function registerAllTools(server: McpServer, deps: ToolDeps): void {
  // Generated layer: one grouped tool per Torn tag.
  for (const tag of TAGS) {
    const title = tagTitle(tag);
    server.registerTool(
      `torn_${tag}`,
      {
        title,
        description: describeTag(tag),
        inputSchema: {
          endpoint: z.enum(endpointNames(tag)).describe(`The ${tag} data type to fetch.`),
          id: z.string().optional().describe("Optional entity id (player/faction/item/etc.)."),
          params: z
            .record(z.union([z.string(), z.number()]))
            .optional()
            .describe("Optional extra query parameters."),
        },
        annotations: readOnly(title),
      },
      async ({ endpoint, id, params }, extra) => deps.callTorn(extra, tag, endpoint, id, params),
    );
  }

  // Intelligence layer: each tool binds the per-request key from its `extra`.
  registerCustomTools(server, deps.makeCall);

  // Discovery tool (no key needed).
  // Reads the bundled catalog only, so it is not open-world.
  server.registerTool(
    "torn_list_endpoints",
    {
      title: "List Torn Endpoints",
      description:
        "Discover Torn endpoints. Pass a 'tag' for that tag's full endpoint " +
        "details (summary, description, accepted query params with every enum value, " +
        "the id variant's own params when they differ, and the response fields each " +
        "endpoint returns). Omit 'tag' for a compact index of every tag and its endpoint names.",
      inputSchema: { tag: z.enum(TAGS).optional().describe("Optional tag to filter by.") },
      annotations: readOnly("List Torn Endpoints", false),
    },
    async ({ tag }) => {
      if (tag) return textResult(JSON.stringify(ENDPOINTS[tag], null, 2));
      const index = Object.fromEntries(TAGS.map((t) => [t, Object.keys(ENDPOINTS[t])]));
      return textResult(JSON.stringify(index, null, 2));
    },
  );
}
