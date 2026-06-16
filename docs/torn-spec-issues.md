# Torn API v2 — OpenAPI spec discrepancies

Reported by the `torn-mcp` live conformance harness (OpenAPI 6.0.0). Each item is
a place where a **real Torn v2 response diverges from Torn's own published
OpenAPI schema** — the spec and the live API disagree. None are client bugs;
they're spec-vs-implementation mismatches worth fixing upstream so the documented
schema validates against real data.

Ready to post to the Torn API dev forum / spec issue tracker. Field paths use
`*` for array indices.

---

## 1. Field-name typos (highest confidence)

The schema declares a misspelled field that the API never returns under that
name — almost certainly a typo in the spec (or the serializer).

| Endpoint | Spec field | Likely intended | Path |
|----------|-----------|-----------------|------|
| `faction/chainreport` | `escpaces` | `escapes` | `/chainreport/attackers/*/attacks` |
| `user/personalstats` | `escpaes` | `escapes` | `/personalstats/attacking` |
| `user/forumsubscribedthreads` | `forumSbuscribedThreads` | `forumSubscribedThreads` | `(root)` |

---

## 2. Wrong scalar type

The schema constrains a field to a type the live value doesn't match.

| Endpoint | Path | Schema expects | Notes |
|----------|------|----------------|-------|
| `company/profile` | `/profile/upgrades/storage_capacity` | `string` (enum) | live value not in the declared string enum |
| `torn/education` | `/education/*/courses/*/rewards/honor` | `string` or `null` | live value is neither |
| `torn/hof` | `/hof/*/value` | `string` | returned as a non-string |
| `user/icons` | `/icons/*/description` | `string` | returned as a non-string |
| `user/stocks` | `/stocks/*/transactions/*/price` | `integer` | non-integer (likely float/string) |
| `user/stocks` | `/stocks/*/bonus/increment` | `integer` | non-integer |
| `user/stocks` | `/stocks/*/bonus/progress` | `integer` | non-integer |
| `user/stocks` | `/stocks/*/bonus/frequency` | `integer` | non-integer |
| `torn/factiontree` | `/factionTree/*/branches/*/upgrades/*/challenge` | `null` | returned as a non-null object |

---

## 3. Wrong container type

The schema declares an array but the API returns an object (or vice versa).

| Endpoint | Path | Schema expects | Live shape |
|----------|------|----------------|-----------|
| `faction/raidreport` | `/raidreport` | `array` | object |
| `faction/territorywarreport` | `/territorywarreport` | `array` | object |
| `market/auctionhouselisting` | `(root)` | object with `id, seller, buyer, timestamp, price, bids, item` | none of those present at root — response is wrapped/shaped differently than documented |

---

## 4. Missing required fields

The schema marks a field `required`, but it's absent from real responses —
either the field was removed/renamed, or it shouldn't be required.

| Endpoint | Missing field | Path |
|----------|--------------|------|
| `faction/upgrades` | `unlockedAt` | `/upgrades/core/upgrades/*`, `/upgrades/peace/*/upgrades/*`, `/upgrades/war/*/upgrades/*` |
| `torn/medals` | `equipped` | `/medals/*` |
| `user/enlistedcars` | `name` | `/enlistedcars/*` |
| `user/organizedcrimes` | `_metadata` | `(root)` |

---

## 5. Enum value not in the declared set

The API returns a value the schema's `enum` doesn't list — the enum is missing a
valid member.

| Endpoint | Path | Notes |
|----------|------|-------|
| `user/missions` | `/missions/rewards/*/details/type` | live `type` value not in enum |
| `user/properties` | `/properties/*/status` | live `status` value not in enum |
| `torn/factiontree` | `/factionTree/*/branches/*/upgrades/*/challenge/stat` | live `stat` value not in enum |

---

*Source: `conformance-baseline.json` in `torn-mcp`. The harness re-checks these
weekly; once Torn fixes one, the run flags it as "Resolved" so it can be pruned
from the baseline.*
