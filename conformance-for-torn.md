# Torn API — OpenAPI spec vs live responses

An automated check called every GET endpoint in the public OpenAPI spec (v6.13.1) with a real key and validated each live JSON response against the response schema the spec documents for it. 151 of 186 endpoints matched exactly; the exceptions are below. (Id-scoped and unscoped variants of the same endpoint are counted once, so the total is lower than the spec's raw GET operation count.)

**The ask: for each endpoint listed, correct the OpenAPI spec so the documented response shape matches what the API actually returns** (or change the response, if the spec is the intended shape). This is documentation drift, not a gameplay bug report — the endpoints all work; their documented types are what's off. It bites anyone generating typed clients or validating responses from the spec.

## Spec/response mismatches (5 endpoints)

The endpoint paths and schema names below are copied verbatim from `openapi.json`, so both can be searched in the spec directly. In the mismatch text, the path is where inside the JSON response body, `*` stands for any array index or numeric key, and the mismatch is between the spec's declared type there and the value the live API returned.

| Endpoint (spec path) | Response schema | Mismatch |
|----------------------|-----------------|----------|
| `GET /company/applications` | `CompanyApplicationsResponse` | `wrong type at /applications/*/player/stats/manual_labor — schema expects integer — live API returns null`<br>`wrong type at /applications/*/player/stats/intelligence — schema expects integer — live API returns null`<br>`wrong type at /applications/*/player/stats/endurance — schema expects integer — live API returns null` |
| `GET /torn/hof` | `TornHofResponse` | `wrong type at /hof/*/value — schema expects string — live API returns number (e.g. 100)` |
| `GET /user/equipment` | `UserEquipmentResponse` | `wrong type at /equipment/*/stats — schema expects object — live API returns null` |
| `GET /user/missions` | `UserMissionsResponse` | `value at /missions/rewards/*/details/type is not one of the allowed values — live value: "Weapon"; spec allows: "Standard", "Hollow Point", "Piercing", "Tracer", "Incendiary"` |
| `GET /user/stocks` | `UserStocksResponse` | `wrong type at /stocks/*/bonus/increment — schema expects integer — live API returns null`<br>`wrong type at /stocks/*/bonus/progress — schema expects integer — live API returns null`<br>`wrong type at /stocks/*/bonus/frequency — schema expects integer — live API returns null` |

## Content-type mismatch (3 endpoints)
These return CSV while the spec documents an `application/json` response: `GET /company/snapshot`, `GET /faction/snapshot`, `GET /user/snapshot`. If CSV is intended, documenting `text/csv` in the spec would fix it.

## Low priority — enum fields that also allow any string (23 endpoints)
Many fields are documented as `oneOf: [<enum>, string]`, so every value matches both branches and the enum constrains nothing. Dropping the `string` branch (or the enum) would make these fields validatable. Endpoints: `GET /company/employees`, `GET /company/{typeId}/companies`, `GET /company/profile`, `GET /company/lookup`, `GET /faction/members`, `GET /faction/lookup`, `GET /forum/lookup`, `GET /key/info`, `GET /market/{id}/auctionhouselisting`, `GET /market/auctionhouse`, `GET /market/{id}/itemmarket`, `GET /market/lookup`, `GET /property/lookup`, `GET /racing/lookup`, `GET /torn/lookup`, `GET /user/basic`, `GET /user/icons`, `GET /user/list`, `GET /user/personalstats`, `GET /user/profile`, `GET /user/properties`, `GET /user/skills`, `GET /user/lookup`

## Fixed since the previous run — confirmed live, thank you (3)
- `GET /torn/factiontree`: `value at /factionTree/*/branches/*/upgrades/*/challenge/stat is not one of the allowed values`; `wrong type at /factionTree/*/branches/*/upgrades/*/challenge — schema expects null`
- `GET /torn/organizedcrimes`: `wrong type at /organizedcrimes/*/slots/*/name — schema expects string`
- `GET /user/equipment`: `wrong type at /equipment/*/ammo — schema expects object`
