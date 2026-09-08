# Torn MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io)

A remote [Model Context Protocol](https://modelcontextprotocol.io) server for the [Torn City](https://www.torn.com) API v2, running on **Cloudflare Workers**. Connect from VS Code (or any MCP client) anywhere — no local install. You supply your Torn API key via the `X-Torn-Api-Key` header; it is never stored, never shown to the model, and never read from the URL (see [Security & privacy](#security--privacy)).

**Tools:** one grouped tool per Torn tag (`torn_user`, `torn_faction`, `torn_torn`, `torn_company`, `torn_market`, `torn_racing`, `torn_forum`, `torn_property`, `torn_key`) covering all 187 endpoints across 234 operations of the spec via an `endpoint` argument — plus **12 intelligence tools** that aggregate endpoints into structured summaries (`analyze_player`, `war_readiness_report`, `find_profitable_items`, …) and `torn_list_endpoints` for discovery.

> [!NOTE]
> Read-only. The Torn API v2 exposes only `GET` endpoints — this server can never modify your account or take in-game actions.

## Install

Live endpoint (hosted instance):

```
https://torn-mcp.yoonutz.workers.dev/mcp
```

**One-click install:**

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=torn&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Ftorn-mcp.yoonutz.workers.dev%2Fmcp%22%2C%22headers%22%3A%7B%22X-Torn-Api-Key%22%3A%22YOUR_TORN_API_KEY%22%7D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=torn&quality=insiders&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Ftorn-mcp.yoonutz.workers.dev%2Fmcp%22%2C%22headers%22%3A%7B%22X-Torn-Api-Key%22%3A%22YOUR_TORN_API_KEY%22%7D%7D)
[![Install in Cursor](https://img.shields.io/badge/Cursor-Install-000000?logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=torn&config=eyJ1cmwiOiJodHRwczovL3Rvcm4tbWNwLnlvb251dHoud29ya2Vycy5kZXYvbWNwIiwiaGVhZGVycyI6eyJYLVRvcm4tQXBpLUtleSI6IllPVVJfVE9STl9BUElfS0VZIn19)

Click a badge → the client opens with the server pre-filled. It installs with a `YOUR_TORN_API_KEY` placeholder — replace it with your real key ([get one](#get-a-torn-api-key)) in the client's MCP settings after install.

**Setup guides** (these clients have no one-click protocol — badge links to their MCP docs; use the config blocks below):

[![Claude Code](https://img.shields.io/badge/Claude_Code-Setup-D97757?logo=anthropic&logoColor=white)](https://docs.claude.com/en/docs/claude-code/mcp)
[![Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Setup-D97757?logo=anthropic&logoColor=white)](https://modelcontextprotocol.io/quickstart/user)
[![Windsurf](https://img.shields.io/badge/Windsurf-Setup-09B6A2?logo=windsurf&logoColor=white)](https://docs.windsurf.com/windsurf/cascade/mcp)
[![Visual Studio](https://img.shields.io/badge/Visual_Studio-Setup-5C2D91?logo=visualstudio&logoColor=white)](https://learn.microsoft.com/en-us/visualstudio/ide/mcp-servers)
[![Continue](https://img.shields.io/badge/Continue-Setup-000000?logo=continue&logoColor=white)](https://docs.continue.dev/customize/deep-dives/mcp)

Or set it up manually — pick your client below. Prefer to self-host? See [Deploy](#deploy).

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

macOS / Linux (bash, zsh):

```bash
code --add-mcp '{"name":"torn","type":"http","url":"https://torn-mcp.yoonutz.workers.dev/mcp","headers":{"X-Torn-Api-Key":"YOUR_TORN_API_KEY"}}'
```

Windows PowerShell — escape the inner quotes with `\"` (the `code.cmd` shim strips plain quotes otherwise):

```powershell
code --add-mcp '{\"name\":\"torn\",\"type\":\"http\",\"url\":\"https://torn-mcp.yoonutz.workers.dev/mcp\",\"headers\":{\"X-Torn-Api-Key\":\"YOUR_TORN_API_KEY\"}}'
```

Insiders: use `code-insiders`. Then open **Copilot Chat → Agent mode → 🛠️ tools** and enable `torn`. (If quoting still fights you, use the manual `mcp.json` below — no escaping needed.)

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

Settings → Developer → Edit Config (`claude_desktop_config.json`). Recent versions accept a remote URL directly:

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

If your version only supports stdio servers (the connection fails), use the `mcp-remote` bridge instead:

```json
{
  "mcpServers": {
    "torn": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://torn-mcp.yoonutz.workers.dev/mcp",
        "--header",
        "X-Torn-Api-Key:YOUR_TORN_API_KEY"
      ]
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

> The **Claude Code** and **VS Code** CLI commands above are tested. The other clients use the same endpoint + `X-Torn-Api-Key` header (verified working), but their config key names and file paths can change between versions — check the client's own MCP docs if a connection fails.

> Security: putting the key inline lands it in config files / shell history. Where the client supports it (e.g. VS Code `${input:...}` prompts), prefer that over a plaintext key.

## Get a Torn API Key

Torn → **Settings → [API Keys](https://www.torn.com/preferences.php#tab=api)** → create a key. A **Limited** or **Minimal** key covers most tools; faction/market selections may need broader scope. Paste it into the `X-Torn-Api-Key` header.

## Tools

One grouped tool per Torn tag, each covering all of that tag's endpoints (table generated from the committed spec by `npm run generate`; counts are checked by the contract test):

<!-- tools:start -->

| Tool                  | Endpoints | Example `endpoint` values                                                                   |
| --------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `torn_user`           | 69        | `ammo`, `attacks`, `attacksfull`, `bars`, `basic`, `battlestats`                            |
| `torn_faction`        | 42        | `applications`, `attacks`, `attacksfull`, `balance`, `basic`, `chain`                       |
| `torn_torn`           | 38        | `attacklog`, `bank`, `bounties`, `calendar`, `cards`, `cityshops`                           |
| `torn_company`        | 10        | `applications`, `employees`, `news`, `companies`, `profile`, `search`                       |
| `torn_market`         | 9         | `auctionhouselisting`, `auctionhouse`, `bazaar`, `itemmarket`, `properties`, `pointsmarket` |
| `torn_racing`         | 8         | `cars`, `carupgrades`, `races`, `race`, `records`, `tracks`                                 |
| `torn_forum`          | 6         | `categories`, `posts`, `thread`, `threads`, `lookup`, `timestamp`                           |
| `torn_property`       | 3         | `property`, `lookup`, `timestamp`                                                           |
| `torn_key`            | 2         | `log`, `info`                                                                               |
| `torn_list_endpoints` | —         | discovery: lists every endpoint per tag                                                     |

<!-- tools:end -->

Each tool takes:

- `endpoint` (required) — which data type to fetch (full list per tool, or call `torn_list_endpoints`).
- `id` (optional) — entity id; used when the endpoint is entity-scoped or requires one. Item endpoints (`market/itemmarket`, `market/bazaar`, `torn/items`) also accept an item **name**; `ids` endpoints accept a comma-separated numeric list; `torn/itemdetails` and `torn/itemstats` take item **uids**, never names.
- `params` (optional) — extra query options (`limit`, `from`, `to`, `sort`, `cat`, …). Only the params the called variant accepts are allowed; anything else is rejected with the accepted list, so a typo cannot be silently ignored by Torn.

The Torn key is **not** a tool parameter — it comes from the request header, so it never enters model context or client transcripts.

### Errors and non-JSON responses

- Torn reports every error as **HTTP 200** with a JSON envelope `{ "error": { "code": N, "error": "..." } }`; the OpenAPI spec documents only the 200 success shape. The server detects the envelope on every endpoint and returns it as a tool error `Torn API error N: message`.
- Three endpoints (`user/snapshot`, `faction/snapshot`, `company/snapshot`) answer **CSV**, not JSON (the spec documents `text/csv`). They are marked `[csv]` in the tool description and return `{ "csv": "<text>", "format": "text/csv" }` in the structured channel with the raw CSV as text — no pagination, no enrichment.
- Any other non-JSON body is reported as `Torn API returned a non-JSON response.`

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

- Key supplied via the `X-Torn-Api-Key` header **only** — never a tool parameter, and never read from the URL. A `?key=` query parameter is ignored (the request fails with a "send the header" error), and the query string is not forwarded past the Worker's front door.
- Never stored, never returned in error messages.
- **Logging, precisely:** this code writes no logs. Cloudflare Workers invocation logs (which would record `<Method> <URL>` per request) are switched off in `wrangler.toml` (`[observability.logs] invocation_logs = false`), so a request URL is not persisted even if a misconfigured client puts a key in it. What this repository cannot control: Cloudflare's own edge/analytics data, and the upstream leg — the key reaches `api.torn.com` as the `key` query parameter Torn documents, which is Torn's log surface, not ours.
- Upstream calls are pinned to `https://api.torn.com` (SSRF guard) with `User-Agent: torn-mcp`.
- Per-key rate limiting (~100 req/min, Torn's cap) via a Durable Object — returns a clear error instead of hammering Torn.

### Dependencies

The deployed Worker's runtime dependencies are `@modelcontextprotocol/sdk` and `zod`. Dev/build tooling advisories are pinned to patched versions via `overrides` in `package.json` (`esbuild`, `js-yaml`, `ws`); `npm audit` is part of the release check — see [SECURITY.md](SECURITY.md).

## Scope & roadmap

Covered: all 9 Torn tags — every documented data endpoint (the counts in the table above are derived from the committed spec) as raw JSON, plus 12 intelligence tools and a discovery tool. The spec is re-synced from Torn weekly; see [docs/ROADMAP.md](docs/ROADMAP.md) for what shipped and what is proposed (MCP resources, prompts, richer per-endpoint output typing).

## License

[MIT](LICENSE) — `// @license MIT` headers are included in all source files.
