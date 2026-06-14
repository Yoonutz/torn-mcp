// @license MIT
// Registers the 12 intelligence-layer tools on the MCP server. Each wraps an
// aggregation service (see services.ts) and returns structured JSON.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, jsonResult, type ToolResult } from "../mcpResult.js";
import { humanizeTimestamps } from "../torn.js";
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
    return jsonResult(humanizeTimestamps(await fn()));
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : "Tool failed.");
  }
}

const ID = z.string().describe("Optional id; omit to use the caller's own data.");

export function registerCustomTools(server: McpServer, call: TornCall): void {
  // ── Player ──
  server.tool(
    "analyze_player",
    "Deep player snapshot: profile + personal stats, with status, activity, " +
      "and life. Aggregates user/profile and user/personalstats.",
    { id: ID.optional() },
    async ({ id }) => run(() => analyzePlayer(call, id)),
  );

  server.tool(
    "summarize_player",
    "Condensed one-glance player snapshot (level, status, activity, life). " +
      "Uses user/profile.",
    { id: ID.optional() },
    async ({ id }) => run(() => summarizePlayer(call, id)),
  );

  server.tool(
    "compare_players",
    "Compare 2+ players side by side (level, status, activity, life) with the " +
      "level gap to the strongest. Fetches user/profile for each id.",
    { ids: z.array(z.string()).min(2).describe("Player ids to compare (>=2).") },
    async ({ ids }) => run(() => comparePlayers(call, ids)),
  );

  // ── Faction ──
  server.tool(
    "summarize_faction",
    "Faction overview: basic details plus member counts by position and by " +
      "activity. Aggregates faction/basic and faction/members.",
    { id: ID.optional() },
    async ({ id }) => run(() => summarizeFaction(call, id)),
  );

  server.tool(
    "faction_member_activity",
    "Bucket faction members into online / idle / offline with counts and " +
      "names. Uses faction/members.",
    { id: ID.optional() },
    async ({ id }) => run(() => factionMemberActivity(call, id)),
  );

  server.tool(
    "war_readiness_report",
    "War-prep readiness from member availability (okay/hospital/traveling, " +
      "online, on-wall, in-OC). Note: per-member battlestats are not exposed " +
      "by the API, so readiness is availability-based. Uses faction/members.",
    { id: ID.optional() },
    async ({ id }) => run(() => warReadinessReport(call, id)),
  );

  server.tool(
    "territory_summary",
    "Faction territory count and holdings, plus a sample of global territory. " +
      "Aggregates faction/territory and torn/territory.",
    { id: ID.optional() },
    async ({ id }) => run(() => territorySummary(call, id)),
  );

  server.tool(
    "crime_analysis",
    "Organized-crime breakdown: counts by status and difficulty with a " +
      "success rate. Uses faction/crimes.",
    { id: ID.optional() },
    async ({ id }) => run(() => crimeAnalysis(call, id)),
  );

  // ── Company ──
  server.tool(
    "summarize_company",
    "Company snapshot: profile plus employee count. Aggregates " +
      "company/profile and company/employees.",
    { id: ID.optional() },
    async ({ id }) => run(() => summarizeCompany(call, id)),
  );

  // ── Market ──
  server.tool(
    "item_market_analysis",
    "Single item: listing depth, lowest/highest price, average price, and " +
      "market value. Aggregates market/itemmarket and torn/items.",
    { id: z.string().describe("Item id.") },
    async ({ id }) => run(() => itemMarketAnalysis(call, id)),
  );

  server.tool(
    "market_analysis",
    "Compare several items by spread (average price minus lowest listing), " +
      "ranked. Fetches market/itemmarket per item.",
    { item_ids: z.array(z.string()).min(1).describe("Item ids to analyze.") },
    async ({ item_ids }) => run(() => marketAnalysis(call, item_ids)),
  );

  server.tool(
    "find_profitable_items",
    "Rank items by margin (reference market value minus lowest listing). " +
      "Aggregates market/itemmarket and torn/items per item.",
    { item_ids: z.array(z.string()).min(1).describe("Item ids to scan.") },
    async ({ item_ids }) => run(() => findProfitableItems(call, item_ids)),
  );
}
