# Torn MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io)

A remote [Model Context Protocol](https://modelcontextprotocol.io) server for the [Torn City](https://www.torn.com) API v2, running on **Cloudflare Workers**. Connect from VS Code (or any MCP client) anywhere — no local install. You supply your Torn API key via the `X-Torn-Api-Key` header; it is never stored, logged, or shown to the model.

**Tools:** one grouped tool per Torn tag (`torn_user`, `torn_faction`, `torn_torn`, `torn_company`, `torn_market`, `torn_racing`, `torn_forum`, `torn_property`, `torn_key`) covering all 205 API paths via an `endpoint` argument — plus **12 intelligence tools** that aggregate endpoints into structured summaries (`analyze_player`, `war_readiness_report`, `find_profitable_items`, …) and `torn_list_endpoints` for discovery.

> [!NOTE]
> Read-only. The Torn API v2 exposes only `GET` endpoints — this server can never modify your account or take in-game actions.

## Install

Live endpoint (hosted instance):

```
https://torn-mcp.yoonutz.workers.dev/mcp
```

Pick your client below. Replace `YOUR_TORN_API_KEY` with your key ([get one](#get-a-torn-api-key)). Prefer to self-host? See [Deploy](#deploy).

<details>
<summary><b>Claude Code</b> (CLI)</summary>

```bash
claude mcp add --transport http torn https://torn-mcp.yoonutz.workers.dev/mcp \
  --header "X-Torn-Api-Key: YOUR_TORN_API_KEY"
```

Check it: `claude mcp list`. Remove: `claude mcp remove torn`.

</details>

<details>
<summary><b>VS Code</b> (CLI)</summary>

```bash
code --add-mcp '{"name":"torn","type":"http","url":"https://torn-mcp.yoonutz.workers.dev/mcp","headers":{"X-Torn-Api-Key":"YOUR_TORN_API_KEY"}}'
```

PowerShell: keep the single quotes around the JSON. Insiders: use `code-insiders`. Then open **Copilot Chat → Agent mode → 🛠️ tools** and enable `torn`.

Manual alternative — user `mcp.json` (Command Palette → _MCP: Open User Configuration_):

```json
{
  "servers": {
    "torn": {
      "type": "http",
      "url": "https://torn-mcp.yoonutz.workers.dev/mcp",
      "headers": { "X-Torn-Api-Key": "YOUR_TORN_API_KEY" }
    }
  }
}
```

</details>

<details>
<summary><b>Cursor</b></summary>

Edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "torn": {
      "url": "https://torn-mcp.yoonutz.workers.dev/mcp",
      "headers": { "X-Torn-Api-Key": "YOUR_TORN_API_KEY" }
    }
  }
}
```

</details>

<details>
<summary><b>Windsurf</b></summary>

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "torn": {
      "serverUrl": "https://torn-mcp.yoonutz.workers.dev/mcp",
      "headers": { "X-Torn-Api-Key": "YOUR_TORN_API_KEY" }
    }
  }
}
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

Settings → Developer → Edit Config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "torn": {
      "url": "https://torn-mcp.yoonutz.workers.dev/mcp",
      "headers": { "X-Torn-Api-Key": "YOUR_TORN_API_KEY" }
    }
  }
}
```

Restart Claude Desktop.

</details>

<details>
<summary><b>Visual Studio</b> (2022 17.14+)</summary>

Add a `.mcp.json` to your solution or `%USERPROFILE%\.mcp.json`:

```json
{
  "servers": {
    "torn": {
      "type": "http",
      "url": "https://torn-mcp.yoonutz.workers.dev/mcp",
      "headers": { "X-Torn-Api-Key": "YOUR_TORN_API_KEY" }
    }
  }
}
```

</details>

<details>
<summary><b>Continue</b></summary>

Edit `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: torn
    type: streamable-http
    url: https://torn-mcp.yoonutz.workers.dev/mcp
    requestOptions:
      headers:
        X-Torn-Api-Key: YOUR_TORN_API_KEY
```

</details>

> Security: putting the key inline lands it in config files / shell history. Where the client supports it (e.g. VS Code `${input:...}` prompts), prefer that over a plaintext key.

## Get a Torn API Key

Torn → **Settings → [API Keys](https://www.torn.com/preferences.php#tab=api)** → create a key. A **Limited** or **Minimal** key covers most tools; faction/market selections may need broader scope. Paste it into the `X-Torn-Api-Key` header.

## Tools

One grouped tool per Torn tag, each covering all of that tag's endpoints:

| Tool                  | Endpoints | Example `endpoint` values                                        |
| --------------------- | --------- | ---------------------------------------------------------------- |
| `torn_user`           | 64        | `profile`, `battlestats`, `bars`, `cooldowns`, `money`, `events` |
| `torn_faction`        | 34        | `basic`, `members`, `wars`, `attacks`, `chain`                   |
| `torn_torn`           | 26        | `items`, `stats`, `timestamp`, `territory`                       |
| `torn_company`        | 10        | `profile`, `employees`, `stock`, `news`                          |
| `torn_market`         | 8         | `itemmarket`, `bazaar`, `auctionhouse`                           |
| `torn_racing`         | 8         | `races`, `cars`, `tracks`, `records`                             |
| `torn_forum`          | 6         | `categories`, `threads`, `posts`                                 |
| `torn_property`       | 2         | `property`                                                       |
| `torn_key`            | 2         | `info`, `log`                                                    |
| `torn_list_endpoints` | —         | discovery: lists every endpoint per tag                          |

Each tool takes:

- `endpoint` (required) — which data type to fetch (full list per tool, or call `torn_list_endpoints`).
- `id` (optional) — entity id; used when the endpoint is entity-scoped or requires one.
- `params` (optional) — extra query options (`limit`, `from`, `to`, `sort`, `cat`, …).

The Torn key is **not** a tool parameter — it comes from the request header, so it never enters model context or client transcripts.

### Intelligence tools

Higher-level tools that aggregate multiple endpoints and return structured summaries instead:

| Tool                      | Aggregates                        | Returns                                |
| ------------------------- | --------------------------------- | -------------------------------------- |
| `analyze_player`          | user/profile + personalstats      | status, activity, life, social, stats  |
| `summarize_player`        | user/profile                      | condensed one-glance snapshot          |
| `compare_players`         | user/profile ×N                   | side-by-side + level gap to top        |
| `summarize_faction`       | faction/basic + members           | counts by position and activity        |
| `faction_member_activity` | faction/members                   | online / idle / offline buckets        |
| `war_readiness_report`    | faction/members                   | availability-based readiness score     |
| `territory_summary`       | faction + torn territory          | holdings + global sample               |
| `crime_analysis`          | faction/crimes                    | status/difficulty counts, success rate |
| `summarize_company`       | company/profile + employees       | profile + headcount                    |
| `item_market_analysis`    | market/itemmarket + torn/items    | depth, price band, market value        |
| `market_analysis`         | market/itemmarket ×N              | items ranked by spread                 |
| `find_profitable_items`   | market/itemmarket + torn/items ×N | items ranked by margin                 |

> War readiness is availability-based (okay/hospital/traveling, online, on-wall, in-OC) — per-member battlestats are not exposed by the Torn API.

## Security & privacy

- Key supplied via `X-Torn-Api-Key` header only — never a tool parameter.
- Never stored, never logged, never returned in error messages.
- Upstream calls are pinned to `https://api.torn.com` (SSRF guard) with `User-Agent: torn-mcp`.
- Per-key rate limiting (~100 req/min, Torn's cap) via a Durable Object — returns a clear error instead of hammering Torn.

## Scope & roadmap

Covered: all 9 Torn tags (160 endpoints / all 205 paths) as raw JSON, plus 12 intelligence tools and a discovery tool. Still on the roadmap from the retired Fastify/Docker design ([superseded spec](docs/superpowers/specs/2026-06-14-torn-mcp-server-design.md)): MCP resources, prompts, and richer per-endpoint output typing.

## License

[MIT](LICENSE) — `// @license MIT` headers are included in all source files.
