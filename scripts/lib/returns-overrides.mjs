// @license MIT
// Reality-derived response-shape corrections for discovery.
//
// Phase 6 derives each endpoint's `returns` (envelope keys + one level of nested
// field names) from the OpenAPI spec. For a few endpoints the spec is wrong (see
// docs/torn-spec-issues.md and conformance-baseline.json), so the spec-derived
// shape would mislead an agent reading the discovery output. These overrides
// replace the spec shape with the ACTUAL live response shape, captured from the
// real API. Keyed by "<tag>/<endpoint>". Applied in buildCatalog().
//
// Keep in sync with reality: if Torn fixes one of these (the conformance run
// flags it "Resolved"), drop the entry so discovery reverts to the spec.
export const RETURNS_OVERRIDES = {
  "faction/raidreport": {
    note: "Spec declares an array; the live response is a single object.",
    returns: [
      { name: "raidreport", type: "object", fields: ["id", "start", "end", "aggressor", "defender"] },
    ],
  },
  "faction/territorywarreport": {
    note: "Spec declares an array; the live response is a single object.",
    returns: [
      {
        name: "territorywarreport",
        type: "object",
        fields: ["id", "territory", "started_at", "ended_at", "winner", "result", "factions"],
      },
    ],
  },
  "market/auctionhouselisting": {
    note: "Spec puts the listing fields at the root; the live response wraps them under 'auctionhouselisting'.",
    returns: [
      {
        name: "auctionhouselisting",
        type: "object",
        fields: ["id", "seller", "buyer", "timestamp", "price", "bids", "item"],
      },
    ],
  },
  "user/enlistedcars": {
    note: "Spec lists 'name'; the live item uses 'car_name' and 'car_item_name'.",
    returns: [
      {
        name: "enlistedcars",
        type: "array",
        fields: [
          "id", "car_item_id", "car_item_name", "car_name", "top_speed", "acceleration",
          "braking", "handling", "safety", "dirt", "tarmac", "class", "worth",
          "points_spent", "races_entered", "races_won", "is_removed", "parts",
        ],
      },
    ],
  },
};
