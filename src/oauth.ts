// @license MIT
// OAuth 2.1 front door for clients that cannot send a Torn API key header
// (e.g. the Claude connector directory). The user pastes their Torn key once on
// /authorize; the client gets an access token that the Worker swaps back for the
// key on every /mcp request.
//
// No server-side secret is needed and the key is never stored in a usable form:
// every token is `<id>.<secret>`; the record named by <id> holds the key
// AES-GCM-encrypted under a key derived from <secret>, which only the token
// holder has. A leaked store is useless without the token.
//
// Clients register dynamically (RFC 7591). Registration is stateless: the
// client_id encodes the client's redirect URIs, which /authorize checks.

import { buildUrl } from "./torn.js";

/** Access tokens live a day; clients refresh them with the refresh token. */
export const ACCESS_TTL_S = 24 * 60 * 60;
/** Refresh tokens live 180 days and rotate on every use. */
export const REFRESH_TTL_S = 180 * 24 * 60 * 60;
/** Authorization codes are single use and short lived. */
export const CODE_TTL_S = 5 * 60;

/** Prefix that tells an OAuth access token apart from a raw Torn key. */
export const TOKEN_PREFIX = "tmcp_";

export type RecordKind = "code" | "access" | "refresh";

/** What the store keeps per token: the encrypted Torn key plus non-secret metadata. */
export interface StoredRecord {
  iv: string;
  ct: string;
  /** Unix ms after which the record is dead. */
  exp: number;
  meta?: Record<string, string>;
}

/** Persistence for token records. `take` reads and deletes in one step. */
export interface TokenStore {
  put(name: string, record: StoredRecord): Promise<void>;
  get(name: string): Promise<StoredRecord | null>;
  take(name: string): Promise<StoredRecord | null>;
  delete(name: string): Promise<void>;
}

export interface OAuthDeps {
  store: TokenStore;
  /** Checks a Torn key works; returns an error message or null. */
  validateKey: (key: string) => Promise<string | null>;
  now?: () => number;
}

// ── encoding helpers ──

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function randomB64(bytes: number): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

async function aesKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", await sha256(fromB64url(secret)), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function seal(secret: string, plaintext: string): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(secret),
    new TextEncoder().encode(plaintext),
  );
  return { iv: b64url(iv), ct: b64url(new Uint8Array(ct)) };
}

export async function unseal(secret: string, rec: { iv: string; ct: string }): Promise<string | null> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(rec.iv) },
      await aesKey(secret),
      fromB64url(rec.ct),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** S256 PKCE check (RFC 7636). */
export async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return b64url(await sha256(verifier)) === challenge;
}

// ── tokens ──

function recordName(kind: RecordKind, id: string): string {
  return `${kind}:${id}`;
}

/** Split `tmcp_<id>.<secret>` (or a bare `<id>.<secret>` code). */
export function parseToken(token: string, prefixed: boolean): { id: string; secret: string } | null {
  let t = token;
  if (prefixed) {
    if (!t.startsWith(TOKEN_PREFIX)) return null;
    t = t.slice(TOKEN_PREFIX.length);
  }
  const m = /^([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{32,64})$/.exec(t);
  return m?.[1] && m[2] ? { id: m[1], secret: m[2] } : null;
}

async function issue(
  deps: OAuthDeps,
  kind: RecordKind,
  tornKey: string,
  ttlS: number,
  meta?: Record<string, string>,
): Promise<string> {
  const id = randomB64(16);
  const secret = randomB64(32);
  const sealed = await seal(secret, tornKey);
  const now = deps.now?.() ?? Date.now();
  await deps.store.put(recordName(kind, id), { ...sealed, exp: now + ttlS * 1000, meta });
  return `${kind === "code" ? "" : TOKEN_PREFIX}${id}.${secret}`;
}

async function redeem(
  deps: OAuthDeps,
  kind: RecordKind,
  token: string,
  consume: boolean,
): Promise<{ key: string; meta?: Record<string, string> } | null> {
  const parsed = parseToken(token, kind !== "code");
  if (!parsed) return null;
  const name = recordName(kind, parsed.id);
  const rec = consume ? await deps.store.take(name) : await deps.store.get(name);
  if (!rec) return null;
  if (rec.exp <= (deps.now?.() ?? Date.now())) {
    if (!consume) await deps.store.delete(name);
    return null;
  }
  const key = await unseal(parsed.secret, rec);
  return key === null ? null : { key, meta: rec.meta };
}

/** Swap an access token for the Torn key it stands for, or null if invalid/expired. */
export async function keyFromAccessToken(deps: OAuthDeps, token: string): Promise<string | null> {
  return (await redeem(deps, "access", token, false))?.key ?? null;
}

// ── clients (stateless dynamic registration) ──

interface ClientInfo {
  redirect_uris: string[];
  client_name?: string;
}

function validRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function encodeClientId(info: ClientInfo): string {
  return "c_" + b64url(new TextEncoder().encode(JSON.stringify(info)));
}

export function decodeClientId(clientId: string): ClientInfo | null {
  if (!clientId.startsWith("c_") || clientId.length > 4096) return null;
  try {
    const info = JSON.parse(new TextDecoder().decode(fromB64url(clientId.slice(2)))) as ClientInfo;
    if (!Array.isArray(info.redirect_uris) || !info.redirect_uris.every((u) => typeof u === "string")) {
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

// ── HTTP ──

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...extra },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    resource_name: "Torn MCP",
    resource_documentation: "https://github.com/Yoonutz/torn-mcp#readme",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    service_documentation: "https://github.com/Yoonutz/torn-mcp#readme",
  };
}

/** 401 that points MCP clients at the OAuth metadata (RFC 9728). */
export function unauthorized(origin: string, error?: "invalid_token"): Response {
  const parts = [`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`];
  if (error) parts.push(`error="${error}"`);
  return new Response(
    JSON.stringify({
      error: error ?? "unauthorized",
      error_description:
        "Sign in with your Torn API key (OAuth), or send it in the X-Torn-Api-Key header.",
    }),
    {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": parts.join(", "), ...CORS },
    },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const AUTH_FIELDS = [
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "resource",
] as const;

function authorizePage(fields: Record<string, string>, clientName: string, error?: string): Response {
  const hidden = AUTH_FIELDS.filter((f) => fields[f])
    .map((f) => `<input type="hidden" name="${f}" value="${escapeHtml(fields[f] ?? "")}">`)
    .join("");
  const host = escapeHtml(new URL(fields.redirect_uri!).host);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Torn MCP</title>
<style>
:root{color-scheme:light dark;--bg:#f4f4f4;--card:#fff;--fg:#222;--muted:#666;--line:#ccc;--accent:#5a7d2a;--err:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#191919;--card:#262626;--fg:#e8e8e8;--muted:#aaa;--line:#444;--accent:#8fb85a;--err:#ff8a80}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;display:flex;justify-content:center;padding:16px}
main{background:var(--card);max-width:440px;width:100%;border:1px solid var(--line);border-radius:10px;padding:24px;margin-top:6vh}
h1{font-size:20px;margin:0 0 8px}p{margin:8px 0;color:var(--muted)}label{display:block;margin:16px 0 6px;font-weight:600}
input[type=password]{width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
button{margin-top:16px;width:100%;padding:10px;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{color:var(--err)}a{color:var(--accent)}ul{color:var(--muted);padding-left:18px}
</style></head><body><main>
<h1>Connect Torn MCP</h1>
<p><strong>${escapeHtml(clientName)}</strong> wants read-only access to your Torn data. You'll go back to <strong>${host}</strong>.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/authorize">${hidden}
<label for="k">Torn API key</label>
<input id="k" name="api_key" type="password" autocomplete="off" required minlength="16" maxlength="16" pattern="[A-Za-z0-9]{16}">
<button type="submit">Connect</button></form>
<ul>
<li>Make one at <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noopener">Torn &gt; Preferences &gt; API Keys</a>. Limited Access covers almost everything.</li>
<li>Read-only: the Torn API can't change your account.</li>
<li>Your key is stored only encrypted, unlockable only with the token your client gets. <a href="https://github.com/Yoonutz/torn-mcp/blob/main/PRIVACY.md" target="_blank" rel="noopener">Privacy</a></li>
</ul></main></body></html>`;
  return new Response(html, {
    status: error ? 400 : 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    },
  });
}

/** Validate the authorize request; returns its fields + client, or an error Response. */
function checkAuthorizeFields(
  fields: Record<string, string>,
): { client: ClientInfo } | { error: Response } {
  const client = decodeClientId(fields.client_id ?? "");
  if (!client) return { error: new Response("Unknown client_id.", { status: 400 }) };
  if (!fields.redirect_uri || !client.redirect_uris.includes(fields.redirect_uri)) {
    return { error: new Response("redirect_uri is not registered for this client.", { status: 400 }) };
  }
  // From here errors can go back to the client.
  const back = (error: string, desc: string) => {
    const u = new URL(fields.redirect_uri!);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", desc);
    if (fields.state) u.searchParams.set("state", fields.state);
    return { error: Response.redirect(u.toString(), 302) };
  };
  if (fields.response_type && fields.response_type !== "code") {
    return back("unsupported_response_type", "Only response_type=code is supported.");
  }
  if (!fields.code_challenge || fields.code_challenge_method !== "S256") {
    return back("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  return { client };
}

async function handleAuthorize(request: Request, deps: OAuthDeps): Promise<Response> {
  if (request.method === "GET") {
    const fields = Object.fromEntries(new URL(request.url).searchParams);
    const checked = checkAuthorizeFields(fields);
    if ("error" in checked) return checked.error;
    return authorizePage(fields, checked.client.client_name || "An MCP client");
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const f of [...AUTH_FIELDS, "response_type"]) {
    const v = form.get(f);
    if (typeof v === "string") fields[f] = v;
  }
  const checked = checkAuthorizeFields(fields);
  if ("error" in checked) return checked.error;
  const clientName = checked.client.client_name || "An MCP client";

  const apiKey = String(form.get("api_key") ?? "").trim();
  if (!/^[A-Za-z0-9]{16}$/.test(apiKey)) {
    return authorizePage(fields, clientName, "A Torn API key is 16 letters and numbers.");
  }
  const problem = await deps.validateKey(apiKey);
  if (problem) return authorizePage(fields, clientName, problem);

  // checkAuthorizeFields guaranteed these three are present.
  const redirectUri = fields.redirect_uri!;
  const code = await issue(deps, "code", apiKey, CODE_TTL_S, {
    client_id: fields.client_id!,
    redirect_uri: redirectUri,
    code_challenge: fields.code_challenge!,
  });
  const u = new URL(redirectUri);
  u.searchParams.set("code", code);
  if (fields.state) u.searchParams.set("state", fields.state);
  return Response.redirect(u.toString(), 302);
}

async function tokenPair(deps: OAuthDeps, tornKey: string, clientId: string): Promise<Response> {
  const access = await issue(deps, "access", tornKey, ACCESS_TTL_S);
  const refresh = await issue(deps, "refresh", tornKey, REFRESH_TTL_S, { client_id: clientId });
  return json({
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: refresh,
  });
}

async function handleToken(request: Request, deps: OAuthDeps): Promise<Response> {
  if (request.method !== "POST") return oauthError("invalid_request", "Use POST.", 405);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return oauthError("invalid_request", "Expected an application/x-www-form-urlencoded body.");
  }
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  const grant = get("grant_type");

  if (grant === "authorization_code") {
    const redeemed = await redeem(deps, "code", get("code"), true);
    if (!redeemed?.meta) return oauthError("invalid_grant", "Code is invalid, used or expired.");
    const m = redeemed.meta;
    if (get("redirect_uri") && get("redirect_uri") !== m.redirect_uri) {
      return oauthError("invalid_grant", "redirect_uri does not match the authorization request.");
    }
    if (get("client_id") && get("client_id") !== m.client_id) {
      return oauthError("invalid_grant", "client_id does not match the authorization request.");
    }
    if (!(await pkceMatches(get("code_verifier"), m.code_challenge ?? ""))) {
      return oauthError("invalid_grant", "PKCE code_verifier does not match.");
    }
    return tokenPair(deps, redeemed.key, m.client_id ?? "");
  }

  if (grant === "refresh_token") {
    // Rotation: the old refresh token is consumed and a new pair issued.
    const redeemed = await redeem(deps, "refresh", get("refresh_token"), true);
    if (!redeemed) return oauthError("invalid_grant", "Refresh token is invalid or expired.");
    const clientId = redeemed.meta?.client_id ?? "";
    if (get("client_id") && clientId && get("client_id") !== clientId) {
      return oauthError("invalid_grant", "client_id does not match the refresh token.");
    }
    return tokenPair(deps, redeemed.key, clientId);
  }

  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

async function handleRegister(request: Request): Promise<Response> {
  if (request.method !== "POST") return oauthError("invalid_request", "Use POST.", 405);
  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = await request.json();
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON.");
  }
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
    return oauthError("invalid_redirect_uri", "Give 1 to 10 redirect_uris.");
  }
  if (!uris.every((u) => typeof u === "string" && validRedirect(u))) {
    return oauthError("invalid_redirect_uri", "redirect_uris must be https (or http on localhost).");
  }
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 80) : undefined;
  const info: ClientInfo = { redirect_uris: uris as string[], ...(name ? { client_name: name } : {}) };
  const clientId = encodeClientId(info);
  if (clientId.length > 4096) return oauthError("invalid_client_metadata", "Metadata too large.");
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: info.redirect_uris,
      ...(name ? { client_name: name } : {}),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

/** Route an OAuth request, or return null when the path is not an OAuth one. */
export async function handleOAuth(request: Request, deps: OAuthDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const isOAuth =
    path.startsWith("/.well-known/oauth-") ||
    path === "/authorize" ||
    path === "/token" ||
    path === "/register";
  if (!isOAuth) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (path.startsWith("/.well-known/oauth-protected-resource")) {
    return json(protectedResourceMetadata(url.origin));
  }
  if (path.startsWith("/.well-known/oauth-authorization-server")) {
    return json(authorizationServerMetadata(url.origin));
  }
  if (path === "/authorize") return handleAuthorize(request, deps);
  if (path === "/token") return handleToken(request, deps);
  if (path === "/register") return handleRegister(request);
  return new Response("Not found", { status: 404 });
}

/** Check a key against Torn's key/info endpoint. */
export async function validateTornKey(key: string): Promise<string | null> {
  try {
    // Same upstream convention as every tool call (Torn's documented `key` param).
    const res = await fetch(buildUrl("/key/info", undefined, key), {
      headers: { "User-Agent": "torn-mcp" },
    });
    const body = (await res.json()) as { error?: { error?: string } };
    if (body?.error) return `Torn rejected this key: ${body.error.error ?? "unknown error"}.`;
    return null;
  } catch {
    return "Couldn't reach Torn to check the key. Try again in a moment.";
  }
}
