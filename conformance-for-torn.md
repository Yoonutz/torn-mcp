# Torn API — OpenAPI spec vs live responses

An automated check called every GET endpoint in the public OpenAPI spec (v6.13.1) with a real key and validated each live JSON response against the response schema the spec documents for it. 151 of 186 endpoints matched exactly; the exceptions are below. (Id-scoped and unscoped variants of the same endpoint are counted once, so the total is lower than the spec's raw GET operation count.)

**The ask: for each endpoint listed, correct the OpenAPI spec so the documented response shape matches what the API actually returns** (or change the response, if the spec is the intended shape). This is documentation drift, not a gameplay bug report — the endpoints all work; their documented types are what's off. It bites anyone generating typed clients or validating responses from the spec.

## Spec/response mismatches (5 endpoints)

Sample payloads are live API v2 responses, trimmed to the relevant branch; `// <--` marks the offending line in each payload. Endpoint paths and schema names are copied verbatim from `openapi.json`, so both can be searched in the spec directly. In each mismatch, the path is where inside the JSON response body, and `*` stands for any array index or numeric key.

### `GET /company/applications` (schema `CompanyApplicationsResponse`)

spec says `manual_labor` is integer; API returns null (at `/applications/*/player/stats/manual_labor`);
spec says `intelligence` is integer; API returns null (at `/applications/*/player/stats/intelligence`);
spec says `endurance` is integer; API returns null (at `/applications/*/player/stats/endurance`):

```json
{
  "applications": [
    {
      "player": {
        "stats": {
          "manual_labor": null, // <-- spec says integer, API returns null
          "intelligence": null, // <-- spec says integer, API returns null
          "endurance": null // <-- spec says integer, API returns null
        }
      }
    }
  ]
}
```

`manual_labor` is null, not the documented integer.

### `GET /torn/hof` (schema `TornHofResponse`)

spec says `value` is string; API returns number (at `/hof/*/value`):

```json
{
  "hof": [
    {
      "value": 100, // <-- spec says string, API returns number
      "id": 99177,
      "username": "BodyBagger",
      "position": 1,
      "faction_id": 8336,
      "level": 100,
      "last_action": 1787571751,
      "rank_name": "Invincible",
      "rank_number": 26,
      "signed_up": 1121742034,
      "age_in_days": 7706,
      "rank": "#26 Invincible",
      "criminal_offenses": 286772
    }
  ]
}
```

`value` is a number, not the documented string.

### `GET /user/equipment` (schema `UserEquipmentResponse`)

spec says `stats` is object; API returns null (at `/equipment/*/stats`):

```json
{
  "equipment": [
    {
      "stats": null, // <-- spec says object, API returns null
      "id": 392,
      "name": "Pepper Spray",
      "uid": 18857650266,
      "type": "Weapon",
      "sub_type": "Temporary",
      "bonuses": [],
      "rarity": null,
      "slot": 5,
      "ammo": null,
      "mods": []
    }
  ]
}
```

`stats` is null, not the documented object.

### `GET /user/missions` (schema `UserMissionsResponse`)

spec allows only "Standard", "Hollow Point", "Piercing", "Tracer", "Incendiary" at `/missions/rewards/*/details/type`; API returns "Weapon":

```json
{
  "missions": {
    "rewards": [
      {
        "details": {
          "type": "Weapon", // <-- not one of the spec's allowed values
          "id": 232,
          "name": "SIG 550",
          "sub_type": "Rifle"
        }
      }
    ]
  }
}
```

Live value "Weapon" is outside the documented enum.

### `GET /user/stocks` (schema `UserStocksResponse`)

spec says `increment` is integer; API returns null (at `/stocks/*/bonus/increment`);
spec says `progress` is integer; API returns null (at `/stocks/*/bonus/progress`);
spec says `frequency` is integer; API returns null (at `/stocks/*/bonus/frequency`):

```json
{
  "stocks": [
    {
      "bonus": {
        "increment": null, // <-- spec says integer, API returns null
        "progress": null, // <-- spec says integer, API returns null
        "frequency": null, // <-- spec says integer, API returns null
        "available": false
      }
    }
  ]
}
```

`increment` is null, not the documented integer.

## Content-type mismatch (3 endpoints)

These return CSV while the spec documents an `application/json` response: `GET /company/snapshot`, `GET /faction/snapshot`, `GET /user/snapshot`. If CSV is intended, documenting `text/csv` in the spec would fix it.

## Low priority — enum fields that also allow any string (23 endpoints)

Many fields are documented as `oneOf: [<enum>, string]`, so every value matches both branches and the enum constrains nothing. Dropping the `string` branch (or the enum) would make these fields validatable. Endpoints: `GET /company/employees`, `GET /company/{typeId}/companies`, `GET /company/profile`, `GET /company/lookup`, `GET /faction/members`, `GET /faction/lookup`, `GET /forum/lookup`, `GET /key/info`, `GET /market/{id}/auctionhouselisting`, `GET /market/auctionhouse`, `GET /market/{id}/itemmarket`, `GET /market/lookup`, `GET /property/lookup`, `GET /racing/lookup`, `GET /torn/lookup`, `GET /user/basic`, `GET /user/icons`, `GET /user/list`, `GET /user/personalstats`, `GET /user/profile`, `GET /user/properties`, `GET /user/skills`, `GET /user/lookup`
