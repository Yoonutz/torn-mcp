// @license MIT
import { describe, it, expect, beforeEach } from "vitest";
import {
  ACCESS_TTL_S,
  TOKEN_PREFIX,
  decodeClientId,
  handleOAuth,
  keyFromAccessToken,
  pkceMatches,
  seal,
  unauthorized,
  unseal,
  type OAuthDeps,
  type StoredRecord,
  type TokenStore,
} from "./oauth.js";

const ORIGIN = "https://torn-mcp.test";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const KEY = "AbCdEf0123456789";
const VERIFIER = "v".repeat(43) + "erifier-0123456789";

async function challengeFor(verifier: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function memoryStore(): TokenStore & { map: Map<string, StoredRecord> } {
  const map = new Map<string, StoredRecord>();
  return {
    map,
    put: async (n, r) => void map.set(n, r),
    get: async (n) => map.get(n) ?? null,
    take: async (n) => {
      const r = map.get(n) ?? null;
      map.delete(n);
      return r;
    },
    delete: async (n) => void map.delete(n),
  };
}

let store: ReturnType<typeof memoryStore>;
let now: number;
let deps: OAuthDeps;

beforeEach(() => {
  store = memoryStore();
  now = 1_000_000;
  deps = {
    store,
    validateKey: async (k) => (k === KEY ? null : "Torn rejected this key: Incorrect key."),
    now: () => now,
  };
});

const call = (path: string, init?: RequestInit) =>
  handleOAuth(new Request(`${ORIGIN}${path}`, init), deps) as Promise<Response>;

const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

async function register(): Promise<string> {
  const res = await call("/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Claude" }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

async function authorize(clientId: string, apiKey = KEY): Promise<Response> {
  return call(
    "/authorize",
    form({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: await challengeFor(VERIFIER),
      code_challenge_method: "S256",
      state: "xyz",
      api_key: apiKey,
    }),
  );
}

async function codeFrom(res: Response): Promise<string> {
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get("location")!);
  expect(loc.origin + loc.pathname).toBe(REDIRECT);
  expect(loc.searchParams.get("state")).toBe("xyz");
  return loc.searchParams.get("code")!;
}

async function exchange(clientId: string, code: string, verifier = VERIFIER) {
  return call(
    "/token",
    form({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT,
    }),
  );
}

describe("OAuth metadata", () => {
  it("publishes protected-resource and authorization-server metadata", async () => {
    const pr = (await (await call("/.well-known/oauth-protected-resource")).json()) as any;
    expect(pr.authorization_servers).toEqual([ORIGIN]);
    expect(pr.resource).toBe(`${ORIGIN}/mcp`);
    const as = (await (await call("/.well-known/oauth-authorization-server")).json()) as any;
    expect(as.registration_endpoint).toBe(`${ORIGIN}/register`);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("answers a 401 that points at the metadata", () => {
    const res = unauthorized(ORIGIN);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
    );
  });

  it("ignores non-OAuth paths", async () => {
    expect(await handleOAuth(new Request(`${ORIGIN}/mcp`), deps)).toBeNull();
  });
});

describe("registration", () => {
  it("encodes redirect URIs in a stateless client_id", async () => {
    const id = await register();
    expect(decodeClientId(id)?.redirect_uris).toEqual([REDIRECT]);
  });

  it("rejects non-https redirect URIs", async () => {
    const res = await call("/register", {
      method: "POST",
      body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("authorize + token flow", () => {
  it("shows the key form, then issues a code, then a token that maps back to the key", async () => {
    const clientId = await register();
    const page = await call(
      `/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: await challengeFor(VERIFIER),
        code_challenge_method: "S256",
      })}`,
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('name="api_key"');

    const code = await codeFrom(await authorize(clientId));
    const tok = (await (await exchange(clientId, code)).json()) as any;
    expect(tok.token_type).toBe("Bearer");
    expect(tok.access_token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(await keyFromAccessToken(deps, tok.access_token)).toBe(KEY);
  });

  it("never stores the key in plain text", async () => {
    const clientId = await register();
    await exchange(clientId, await codeFrom(await authorize(clientId)));
    for (const rec of store.map.values()) expect(JSON.stringify(rec)).not.toContain(KEY);
  });

  it("re-renders the form when Torn rejects the key", async () => {
    const res = await authorize(await register(), "ZZZZZZZZZZZZZZZZ");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Incorrect key");
  });

  it("refuses an unregistered redirect_uri without redirecting", async () => {
    const clientId = await register();
    const res = await call(`/authorize?client_id=${clientId}&redirect_uri=https://evil.example/cb`);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("rejects a wrong PKCE verifier and a reused code", async () => {
    const clientId = await register();
    const code = await codeFrom(await authorize(clientId));
    expect((await exchange(clientId, code, "w".repeat(50))).status).toBe(400);
    // The failed attempt consumed the code: single use.
    expect((await exchange(clientId, code)).status).toBe(400);
  });

  it("expires access tokens and rotates refresh tokens", async () => {
    const clientId = await register();
    const tok = (await (await exchange(clientId, await codeFrom(await authorize(clientId)))).json()) as any;
    now += (ACCESS_TTL_S + 1) * 1000;
    expect(await keyFromAccessToken(deps, tok.access_token)).toBeNull();

    const refreshed = await call(
      "/token",
      form({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: clientId }),
    );
    const next = (await refreshed.json()) as any;
    expect(await keyFromAccessToken(deps, next.access_token)).toBe(KEY);
    const again = await call(
      "/token",
      form({ grant_type: "refresh_token", refresh_token: tok.refresh_token }),
    );
    expect(again.status).toBe(400);
  });

  it("rejects forged or malformed tokens", async () => {
    expect(await keyFromAccessToken(deps, `${TOKEN_PREFIX}${"a".repeat(22)}.${"b".repeat(43)}`)).toBeNull();
    expect(await keyFromAccessToken(deps, "not-a-token")).toBeNull();
  });
});

describe("crypto helpers", () => {
  it("round-trips and fails closed with the wrong secret", async () => {
    const secret = "s".repeat(43);
    const sealed = await seal(secret, KEY);
    expect(await unseal(secret, sealed)).toBe(KEY);
    expect(await unseal("t".repeat(43), sealed)).toBeNull();
  });

  it("checks S256 PKCE", async () => {
    expect(await pkceMatches(VERIFIER, await challengeFor(VERIFIER))).toBe(true);
    expect(await pkceMatches("short", await challengeFor("short"))).toBe(false);
  });
});
