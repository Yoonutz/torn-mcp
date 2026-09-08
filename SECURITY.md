# Security Policy

## Supported versions

This project is pre-1.0 and ships from `main`. Only the latest released
version receives security fixes.

| Version                                              | Supported |
| ---------------------------------------------------- | --------- |
| latest release on `main` (`GET /version` reports it) | ✅        |
| older                                                | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's **[Report a vulnerability](https://github.com/Yoonutz/torn-mcp/security/advisories/new)**
(repository → **Security** → **Advisories** → _Report a vulnerability_). This
opens a private advisory only the maintainers can see.

Include, where possible:

- A description of the issue and its impact.
- Steps to reproduce (a minimal request/response is ideal).
- Affected version (`GET /version`) and deployment (hosted vs self-hosted).

You can expect an acknowledgement within a few days. We'll work with you on a
fix and coordinate disclosure once a patch is available; please give us a
reasonable window before publishing details.

## How this server handles your API key

Torn API keys are treated as secrets on every request:

- **Header only.** The key is read from the `X-Torn-Api-Key` request header. It
  is never a tool parameter, so it never enters the model's context or client
  transcripts. It is never read from the URL: a `?key=` query parameter is
  ignored and the query string is not forwarded past the Worker's front door.
- **Never stored.** The key lives only for the duration of one request; it is
  not persisted in any Durable Object or storage.
- **Not logged by this server, and not logged by Cloudflare invocation logs.**
  The code writes no logs and never echoes the key in errors or responses.
  Cloudflare Workers invocation logs, which record `<Method> <URL>` per request
  and persist for 3-7 days, are disabled in `wrangler.toml`
  (`[observability.logs] invocation_logs = false`). Outside this repository's
  control: Cloudflare's own edge/analytics data, and the upstream leg, where the
  key is sent to `api.torn.com` as the `key` query parameter Torn documents.
- **Egress-restricted (SSRF guard).** Outbound calls go only to the fixed
  `api.torn.com` host, even when following Torn's own pagination links — the key
  can never be sent anywhere else.
- **Read-only.** The Torn API v2 exposes only `GET` endpoints, so the server
  cannot modify your account or take in-game actions.
- **Rate limited per key** to stay within Torn's limits and limit abuse.

Use the lowest-scope Torn key that covers your needs.

## Self-hosting notes

- Provide secrets through your platform's secret store (e.g.
  `wrangler secret put TORN_API_KEY`); never bake them into images or commit
  them. `.dev.vars` and `.env` are gitignored.
- The optional admin/fallback key (`TORN_API_KEY`) makes header-less callers
  single-tenant — set it only if you intend that.

## Dependencies

Dependencies are monitored with Dependabot. Advisories with no runtime impact
(dev/build tooling, or unused features of a dependency) are tracked and
documented rather than force-upgraded when the upgrade would break the build.

The deployed Worker's only runtime dependencies are `@modelcontextprotocol/sdk`
and `zod`. Transitive advisories in dev/build tooling are pinned to patched
versions via `overrides` in `package.json` — surgically, without downgrading the
direct dependency. Currently pinned: `ws` (via `wrangler`→`miniflare`), `js-yaml`
(via `openapi-typescript`→`@redocly`), and `esbuild`.

`npm audit` is not always clean: advisories surface in the `wrangler`→`miniflare`
chain (`nanoid`, `sharp`, `undici` at the time of writing, 2026-09-08). That chain
runs only on a developer machine (`wrangler dev`) and in CI; none of it ships in
the Worker bundle. Such advisories are tracked and cleared with the next
`wrangler` release rather than force-upgraded when that would break the build.

## Scope

In scope: the MCP server code, request handling, key/secret handling, and
deployment configuration in this repository.

Out of scope: the upstream Torn API itself, the MCP client you connect with, and
vulnerabilities requiring a compromised host or a key the reporter does not own.
