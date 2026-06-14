# Torn MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io)

A remote [Model Context Protocol](https://modelcontextprotocol.io) server for the [Torn City](https://www.torn.com) API v2, running on **Cloudflare Workers**. Connect from VS Code (or any MCP client) anywhere — no local install. You supply your Torn API key via the `X-Torn-Api-Key` header; it is never stored, logged, or shown to the model.

**Tools:** one grouped tool per Torn tag (`torn_user`, `torn_faction`, `torn_torn`, `torn_company`, `torn_market`, `torn_racing`, `torn_forum`, `torn_property`, `torn_key`) covering all 205 API paths via an `endpoint` argument — plus **12 intelligence tools** that aggregate endpoints into structured summaries (`analyze_player`, `war_readiness_report`, `find_profitable_items`, …) and `torn_list_endpoints` for discovery.

> [!NOTE]
> Read-only. The Torn API v2 exposes only `GET` endpoints — this server can never modify your account or take in-game actions.

## Use it (client setup)

The deployed endpoint is:

```
https://torn-mcp.<your-account-subdomain>.workers.dev/mcp
```

(Replace `<your-account-subdomain>` with the one Cloudflare assigns after your first deploy — see [Deploy](#deploy). Add a custom domain later to drop the `workers.dev` host.)

**VS Code** — user-level `mcp.json` (works from any workspace):

```json
{
  "servers": {
    "torn": {
      "type": "http",
      "url": "https://torn-mcp.<your-account-subdomain>.workers.dev/mcp",
      "headers": { "X-Torn-Api-Key": "YOUR_TORN_API_KEY" }
    }
  }
}
```

Same `url` + `headers` block works for Claude Desktop, Cursor, Windsurf, and Continue under their `mcpServers`/`servers` config.

## Get a Torn API Key

Torn → **Settings → [API Keys](https://www.torn.com/preferences.php#tab=api)** → create a key. A **Limited** or **Minimal** key covers most tools; faction/market selections may need broader scope. Paste it into the `X-Torn-Api-Key` header.

## Tools

One grouped tool per Torn tag, each covering all of that tag's endpoints:

| Tool | Endpoints | Example `endpoint` values |
|------|-----------|---------------------------|
| `torn_user` | 64 | `profile`, `battlestats`, `bars`, `cooldowns`, `money`, `events` |
| `torn_faction` | 34 | `basic`, `members`, `wars`, `attacks`, `chain` |
| `torn_torn` | 26 | `items`, `stats`, `timestamp`, `territory` |
| `torn_company` | 10 | `profile`, `employees`, `stock`, `news` |
| `torn_market` | 8 | `itemmarket`, `bazaar`, `auctionhouse` |
| `torn_racing` | 8 | `races`, `cars`, `tracks`, `records` |
| `torn_forum` | 6 | `categories`, `threads`, `posts` |
| `torn_property` | 2 | `property` |
| `torn_key` | 2 | `info`, `log` |
| `torn_list_endpoints` | — | discovery: lists every endpoint per tag |

Each tool takes:
- `endpoint` (required) — which data type to fetch (full list per tool, or call `torn_list_endpoints`).
- `id` (optional) — entity id; used when the endpoint is entity-scoped or requires one.
- `params` (optional) — extra query options (`limit`, `from`, `to`, `sort`, `cat`, …).

The Torn key is **not** a tool parameter — it comes from the request header, so it never enters model context or client transcripts.

### Intelligence tools

Higher-level tools that aggregate multiple endpoints and return structured summaries instead of raw JSON:

| Tool | Aggregates | Returns |
|------|-----------|---------|
| `analyze_player` | user/profile + personalstats | status, activity, life, social, stats |
| `summarize_player` | user/profile | condensed one-glance snapshot |
| `compare_players` | user/profile ×N | side-by-side + level gap to top |
| `summarize_faction` | faction/basic + members | counts by position and activity |
| `faction_member_activity` | faction/members | online / idle / offline buckets |
| `war_readiness_report` | faction/members | availability-based readiness score |
| `territory_summary` | faction + torn territory | holdings + global sample |
| `crime_analysis` | faction/crimes | status/difficulty counts, success rate |
| `summarize_company` | company/profile + employees | profile + headcount |
| `item_market_analysis` | market/itemmarket + torn/items | depth, price band, market value |
| `market_analysis` | market/itemmarket ×N | items ranked by spread |
| `find_profitable_items` | market/itemmarket + torn/items ×N | items ranked by margin |

> War readiness is availability-based (okay/hospital/traveling, online, on-wall, in-OC) — per-member battlestats are not exposed by the Torn API.

## Deploy

Prereqs: Node 18+, a Cloudflare account, `npx wrangler login` once.

```bash
git clone https://github.com/Yoonutz/torn-mcp.git
cd torn-mcp
npm install
npx wrangler deploy
```

After the first deploy, wrangler prints your live URL:
`https://torn-mcp.<your-account-subdomain>.workers.dev`. The MCP endpoint is that URL + `/mcp`.

### Optional: server-level fallback key

By default the server is multi-tenant — every request must carry `X-Torn-Api-Key`. To set a fallback key used when the header is absent (makes header-less callers single-tenant):

```bash
npx wrangler secret put TORN_API_KEY
```

The secret is never exposed to the model and never logged.

### Custom domain (optional)

Default `*.workers.dev` URLs include your account subdomain. To use your own domain (must be on Cloudflare), uncomment the `routes` block in [`wrangler.toml`](wrangler.toml), set the pattern, and redeploy. The endpoint becomes `https://<your-pattern>/mcp`.

## Test with MCP Inspector

Before wiring a client, verify the server with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector
```

In the Inspector: transport **Streamable HTTP**, URL = your `/mcp` endpoint, add header `X-Torn-Api-Key: YOUR_TORN_API_KEY`. Connect → list tools → call `torn_torn` with `endpoint=timestamp` to confirm a live response.

## Security & privacy

- Key supplied via `X-Torn-Api-Key` header only — never a tool parameter.
- Never stored, never logged, never returned in error messages.
- Upstream calls are pinned to `https://api.torn.com` (SSRF guard) with `User-Agent: torn-mcp`.
- Per-key rate limiting (~100 req/min, Torn's cap) via a Durable Object — returns a clear error instead of hammering Torn.

## Development

```bash
npm run dev        # local dev server (wrangler dev)
npm run test       # unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run deploy     # wrangler deploy
npm run cf-typegen # regenerate Worker binding types
```

| File | Purpose |
|------|---------|
| [`src/index.ts`](src/index.ts) | Worker entry: MCP agent, tool wiring, shared fetch core, header auth |
| [`src/torn.ts`](src/torn.ts) | Pure Torn path/URL/error helpers (unit-tested) |
| [`src/custom/services.ts`](src/custom/services.ts) | 12 intelligence aggregation services (unit-tested) |
| [`src/custom/tools.ts`](src/custom/tools.ts) | Registers the intelligence tools on the MCP server |
| [`src/rateLimiter.ts`](src/rateLimiter.ts) | Per-key rate-limit Durable Object |
| [`src/generated/endpoints.ts`](src/generated/endpoints.ts) | Auto-generated endpoint catalog (do not edit) |
| [`scripts/sync-openapi.mjs`](scripts/sync-openapi.mjs) | Download spec + regenerate the catalog |
| [`wrangler.toml`](wrangler.toml) | Worker name, DO bindings, migrations |

Run `npm run sync-openapi` to pull the latest Torn spec and regenerate `src/generated/endpoints.ts`.

## Scope & roadmap

Covered: all 9 Torn tags (160 endpoints / all 205 paths) as raw JSON, plus 12 intelligence tools and a discovery tool. Still on the roadmap from the retired Fastify/Docker design ([superseded spec](docs/superpowers/specs/2026-06-14-torn-mcp-server-design.md)): MCP resources, prompts, and richer per-endpoint output typing.

## License

[MIT](LICENSE) — `// @license MIT` headers are included in all source files.
