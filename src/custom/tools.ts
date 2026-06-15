// @license MIT
// Registers the 12 intelligence-layer tools on the MCP server. Each wraps an
// aggregation service (see services.ts) and returns structured JSON.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dualResult, errorResult, type ToolResult } from "../mcpResult.js";
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
  server.tool(
    "analyze_player",
    "Deep player snapshot: profile + personal stats, with status, activity, " +
      "and life. Aggregates user/profile and user/personalstats.",
    { id: ID.optional() },
    async ({ id }, extra) => run(() => analyzePlayer(makeCall(extra), id)),
  );

  server.tool(
    "summarize_player",
    "Condensed one-glance player snapshot (level, status, activity, life). " +
      "Uses user/profile.",
    { id: ID.optional() },
    async ({ id }, extra) => run(() => summarizePlayer(makeCall(extra), id)),
  );

  server.tool(
    "compare_players",
    "Compare 2+ players side by side (level, status, activity, life) with the " +
      "level gap to the strongest. Fetches user/profile for each id.",
    { ids: z.array(z.string()).min(2).describe("Player ids to compare (>=2).") },
    async ({ ids }, extra) => run(() => comparePlayers(makeCall(extra), ids)),
  );

  // ── Faction ──
  server.tool(
    "summarize_faction",
    "Faction overview: basic details plus member counts by position and by " +
      "activity. Aggregates faction/basic and faction/members.",
    { id: ID.optional() },
    async ({ id }, extra) => run(() => summarizeFaction(makeCall(extra), id)),
  );

  server.tool(
    "faction_member_activity",
    "Bucket faction members into online / idle / offline with counts and " +
      "names. Uses faction/members.",
    { id: ID.optional() },
    async ({ id }, extra) => run(() => factionMemberActivity(makeCall(extra), id)),
  );

  server.tool(
    "war_readiness_report",
    "War-prep readiness from member availability (okay/hospital/traveling, " +
      "online, on-wall, in-OC). Note: per-member battlestats are not exposed " +
      "by the API, so readiness is availability-based. Uses faction/members.",
    { id: ID.optional() },
    async ({ id }, extra) => run(() => warReadinessReport(makeCall(extra), id)),
  );

  server.tool(
    "territory_summary",
    "Faction territory count and holdings, plus a sample of global territory. " +
      "Aggregates faction/territory and torn/territory.",
    { id: ID.optional() },
    async ({ id }, extra) => run(() => territorySummary(makeCall(extra), id)),
  );

  server.tool(
    "crime_analysis",
    "Organized-crime breakdown: counts by status and difficulty with a " +
      "success rate. Uses faction/crimes.",
    { id: ID.optional() },
    async ({ id }, extra) => run(() => crimeAnalysis(makeCall(extra), id)),
  );

  // ── Company ──
  server.tool(
    "summarize_company",
    "Company snapshot: profile plus employee count. Aggregates " +
      "company/profile and company/employees.",
    { id: ID.optional() },
    async ({ id }, extra) => run(() => summarizeCompany(makeCall(extra), id)),
  );

  // ── Market ──
  server.tool(
    "item_market_analysis",
    "Single item: listing depth, lowest/highest price, average price, and " +
      "market value. Aggregates market/itemmarket and torn/items.",
    { id: z.string().describe("Item id.") },
    async ({ id }, extra) => run(() => itemMarketAnalysis(makeCall(extra), id)),
  );

  server.tool(
    "market_analysis",
    "Compare several items by spread (average price minus lowest listing), " +
      "ranked. Fetches market/itemmarket per item.",
    { item_ids: z.array(z.string()).min(1).describe("Item ids to analyze.") },
    async ({ item_ids }, extra) => run(() => marketAnalysis(makeCall(extra), item_ids)),
  );

  server.tool(
    "find_profitable_items",
    "Rank items by margin (reference market value minus lowest listing). " +
      "Aggregates market/itemmarket and torn/items per item.",
    { item_ids: z.array(z.string()).min(1).describe("Item ids to scan.") },
    async ({ item_ids }, extra) => run(() => findProfitableItems(makeCall(extra), item_ids)),
  );
}
