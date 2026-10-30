# Privacy Policy

_Last updated: 2026-10-30 (OAuth sign-in added)_

Torn MCP is a free, open-source [Model Context Protocol](https://modelcontextprotocol.io) server for the
[Torn City](https://www.torn.com) API v2. The hosted instance runs at
`https://torn-mcp.yoonutz.workers.dev/mcp` on Cloudflare Workers. This policy covers that hosted instance.

## What we collect

Nothing. There are no accounts, no sign-up, no analytics, no cookies and no database.

## Your Torn API key

You give the server your key in one of two ways:

- **Request header** (`X-Torn-Api-Key`, `X-Api-Key` or `Authorization: Bearer`): the key is used only to forward
  that request to `https://api.torn.com` and is never stored.
- **OAuth sign-in** (used by Claude's connector directory): you paste the key once on the server's sign-in page.
  It is checked against Torn, then stored **only encrypted** (AES-GCM) under a key derived from the token issued
  to your client. The server keeps no key of its own that can decrypt it, so the stored data is useless without
  your token. Access tokens last 24 hours, refresh tokens 180 days; expired records are deleted automatically.
  Disconnecting the connector and deleting the key in Torn ends access for good.

Either way, the key is never logged by this server, never returned in a response or error, and never shown to
the AI model (it is not a tool parameter).
- A SHA-256 hash of the key names an in-memory rate-limit counter (about 100 requests per minute, Torn's own
  limit). The counter holds only a request count, is never written to disk, and resets when idle.

## Torn data

Tool results are fetched from the Torn API on demand and returned straight to your MCP client. They are not
cached or stored by this server. The server is read-only: the Torn API v2 has only `GET` endpoints, so it cannot
change your account or take in-game actions.

## Sessions

An MCP session id (a random UUID) keeps your client's connection open. It holds no personal data and expires
when the session ends.

## Third parties

- **Cloudflare** hosts the server. Cloudflare Workers invocation logs are switched off for this server, but
  Cloudflare keeps its own edge and security data under the
  [Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/).
- **Torn** receives your key and request as documented by the Torn API. See Torn's
  [API terms](https://www.torn.com/api.html) and [rules](https://www.torn.com/rules.php).

We do not sell, share or rent any data, and nothing is used for advertising or model training.

## Your choices

Remove the server from your MCP client, or delete or rotate your key in Torn's API settings, at any time.
Use the lowest-access key that covers what you need.

## Contact

Questions or requests: open an issue at <https://github.com/Yoonutz/torn-mcp/issues>. Security problems:
report privately as described in [SECURITY.md](SECURITY.md).

## Changes

Changes to this policy are published in this file; its history is on GitHub.
