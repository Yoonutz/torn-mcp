// @license MIT
// Registers the 12 intelligence-layer tools on the MCP server. Each wraps an
// aggregation service (see services.ts) and returns structured JSON.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dualResult, errorResult, type ToolResult } from "../mcpResult.js";
import { humanizeTimestamps } from "../torn.js";
import { readOnly } from "../annotations.js";
import {
  analyzePlayer,
  comparePlayers,
  crimeAnalysis,
  factionMemberActivity,
  findProfitableItems,
  itemMarketAnalysis,
  marketAnalysis,
  summarizeCompany,
  summarizeFaction,
  summarizePlayer,
  territorySummary,
  warReadinessReport,
  type TornCall,
} from "./services.js";

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const data = await fn();
    // Canonical structured data; humanized presentation as text.
    return dualResult(data, JSON.stringify(humanizeTimestamps(data), null, 2));
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : "Tool failed.");
  }
}

const ID = z.string().describe("Optional id; omit to use the caller's own data.");

export function registerCustomTools(
  server: McpServer,
  makeCall: (extra: unknown) => TornCall,
): void {
  // ── Player ──
  server.registerTool(
    "analyze_player",
    {
      title: "Analyze Player",
      description:
        "Deep player snapshot: profile + personal stats, with status, activity, " +
        "and life. Aggregates user/profile and user/personalstats.",
      inputSchema: { id: ID.optional() },
      annotations: readOnly("Analyze Player"),
    },
    async ({ id }, extra) => run(() => analyzePlayer(makeCall(extra), id)),
  );

  server.registerTool(
    "summarize_player",
    {
      title: "Summarize Player",
      description:
        "Condensed one-glance player snapshot (level, status, activity, life). " +
        "Uses user/profile.",
      inputSchema: { id: ID.optional() },
      annotations: readOnly("Summarize Player"),
    },
    async ({ id }, extra) => run(() => summarizePlayer(makeCall(extra), id)),
  );

  server.registerTool(
    "compare_players",
    {
      title: "Compare Players",
      description:
        "Compare 2+ players side by side (level, status, activity, life) with the " +
        "level gap to the strongest. Fetches user/profile for each id.",
      inputSchema: { ids: z.array(z.string()).min(2).describe("Player ids to compare (>=2).") },
      annotations: readOnly("Compare Players"),
    },
    async ({ ids }, extra) => run(() => comparePlayers(makeCall(extra), ids)),
  );

  // ── Faction ──
  server.registerTool(
    "summarize_faction",
    {
      title: "Summarize Faction",
      description:
        "Faction overview: basic details plus member counts by position and by " +
        "activity. Aggregates faction/basic and faction/members.",
      inputSchema: { id: ID.optional() },
      annotations: readOnly("Summarize Faction"),
    },
    async ({ id }, extra) => run(() => summarizeFaction(makeCall(extra), id)),
  );

  server.registerTool(
    "faction_member_activity",
    {
      title: "Faction Member Activity",
      description:
        "Bucket faction members into online / idle / offline with counts and " +
        "names. Uses faction/members.",
      inputSchema: { id: ID.optional() },
      annotations: readOnly("Faction Member Activity"),
    },
    async ({ id }, extra) => run(() => factionMemberActivity(makeCall(extra), id)),
  );

  server.registerTool(
    "war_readiness_report",
    {
      title: "War Readiness Report",
      description:
        "War-prep readiness from member availability (okay/hospital/traveling, " +
        "online, on-wall, in-OC). Note: per-member battlestats are not exposed " +
        "by the API, so readiness is availability-based. Uses faction/members.",
      inputSchema: { id: ID.optional() },
      annotations: readOnly("War Readiness Report"),
    },
    async ({ id }, extra) => run(() => warReadinessReport(makeCall(extra), id)),
  );

  server.registerTool(
    "territory_summary",
    {
      title: "Territory Summary",
      description:
        "Faction territory count and holdings, plus a sample of global territory. " +
        "Aggregates faction/territory and torn/territory.",
      inputSchema: { id: ID.optional() },
      annotations: readOnly("Territory Summary"),
    },
    async ({ id }, extra) => run(() => territorySummary(makeCall(extra), id)),
  );

  server.registerTool(
    "crime_analysis",
    {
      title: "Organized Crime Analysis",
      description:
        "Organized-crime breakdown: counts by status and difficulty with a " +
        "success rate. Uses faction/crimes.",
      inputSchema: { id: ID.optional() },
      annotations: readOnly("Organized Crime Analysis"),
    },
    async ({ id }, extra) => run(() => crimeAnalysis(makeCall(extra), id)),
  );

  // ── Company ──
  server.registerTool(
    "summarize_company",
    {
      title: "Summarize Company",
      description:
        "Company snapshot: profile plus employee count. Aggregates " +
        "company/profile and company/employees.",
      inputSchema: { id: ID.optional() },
      annotations: readOnly("Summarize Company"),
    },
    async ({ id }, extra) => run(() => summarizeCompany(makeCall(extra), id)),
  );

  // ── Market ──
  server.registerTool(
    "item_market_analysis",
    {
      title: "Item Market Analysis",
      description:
        "Single item: listing depth, lowest/highest price, average price, and " +
        "market value. Aggregates market/itemmarket and torn/items.",
      inputSchema: { id: z.string().describe("Item id.") },
      annotations: readOnly("Item Market Analysis"),
    },
    async ({ id }, extra) => run(() => itemMarketAnalysis(makeCall(extra), id)),
  );

  server.registerTool(
    "market_analysis",
    {
      title: "Market Spread Analysis",
      description:
        "Compare several items by spread (average price minus lowest listing), " +
        "ranked. Fetches market/itemmarket per item.",
      inputSchema: { item_ids: z.array(z.string()).min(1).describe("Item ids to analyze.") },
      annotations: readOnly("Market Spread Analysis"),
    },
    async ({ item_ids }, extra) => run(() => marketAnalysis(makeCall(extra), item_ids)),
  );

  server.registerTool(
    "find_profitable_items",
    {
      title: "Find Profitable Items",
      description:
        "Rank items by margin (reference market value minus lowest listing). " +
        "Aggregates market/itemmarket and torn/items per item.",
      inputSchema: { item_ids: z.array(z.string()).min(1).describe("Item ids to scan.") },
      annotations: readOnly("Find Profitable Items"),
    },
    async ({ item_ids }, extra) => run(() => findProfitableItems(makeCall(extra), item_ids)),
  );
}
