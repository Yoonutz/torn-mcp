// @license MIT
// Seed data for the conformance harness: how to obtain ids, required query param
// values, and which endpoints are expected to be un-seedable.
//
// Edit this file to add seeds for newly added endpoints or to document new
// expected skips. The harness imports these constants directly.

// ── Seed map: how to obtain an id for each id-required endpoint ──────
// kind: "const" | "item" | "list" (pluck first array item's `field`, default id)
export const SEEDS = {
  "company/companies": { kind: "const", value: "1" },
  "market/properties": { kind: "const", value: "1" },
  "market/rentals": { kind: "const", value: "1" },
  "market/itemmarket": { kind: "item" },
  "market/auctionhouselisting": { kind: "list", source: "market/auctionhouse" },
  // itemdetails needs a specific item UID (instance), not the item type id; pull
  // one from a live auction-house listing's nested item.uid.
  "torn/itemdetails": { kind: "list", source: "market/auctionhouse", field: "item.uid" },
  "faction/crime": { kind: "list", source: "faction/crimes" },
  "faction/raidreport": { kind: "list", source: "faction/raids" },
  "faction/rankedwarreport": { kind: "list", source: "faction/rankedwars" },
  "faction/territorywarreport": { kind: "list", source: "faction/territorywars" },
  "forum/thread": { kind: "list", source: "forum/threads" },
  "forum/posts": { kind: "list", source: "forum/threads" },
  "racing/race": {
    kind: "list",
    source: "racing/races",
    sourceParams: { sort: "ASC" }, // oldest races are finished; race detail needs a finished race
    where: { status: "finished" },
  },
  "racing/records": { kind: "list", source: "racing/tracks" },
  // crimes & subcrimes key off a crime TYPE id (1-13 from torn/crimes), not an
  // organized-crime id.
  "torn/subcrimes": { kind: "list", source: "torn/crimes" },
  "user/crimes": { kind: "list", source: "torn/crimes" },
  "user/trade": { kind: "list", source: "user/trades" },
  "torn/eliminationteam": { kind: "list", source: "torn/elimination" },
};

// ── Param seeds ─────────────────────────────────────────────────────
// Some endpoints need a required QUERY param whose value must come from live
// data (not an enum default and not a path id). Resolve it from a list source.
export const PARAM_SEEDS = {
  // attacklog needs a 'log' code; every user/attacks row carries one.
  "torn/attacklog": { param: "log", source: "user/attacks", field: "code" },
};

// ── Required-param overrides ─────────────────────────────────────────
// Some endpoints mark a param optional but the API needs it. Supply a valid
// value so they can be tested.
export const PARAM_OVERRIDES = {
  "user/inventory": { cat: "Collectible" },
  "user/personalstats": { cat: "all" },
};

// ── Documented skips ────────────────────────────────────────────────
// Endpoints that can't be live-validated with the test key, and why. Like the
// drift baseline: a skip listed here is EXPECTED (account state or no id source,
// verified 2026-06), so it's reported quietly. A skip NOT listed here is
// unexpected — a seed broke, or a new endpoint needs one — and gets surfaced.
export const DOCUMENTED_SKIPS = {
  "user/trade": "transient — tested when an active trade exists, quietly skipped when there are none",
  "torn/eliminationteam": "seasonal elimination event; team id rejected off-season (Torn 'Incorrect ID')",
  "company/snapshot": "returns CSV, not JSON — outside schema scope",
  "faction/snapshot": "returns CSV, not JSON — outside schema scope",
  "user/snapshot": "returns CSV, not JSON — outside schema scope",
};
