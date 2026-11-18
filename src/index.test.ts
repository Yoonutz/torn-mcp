// @license MIT
// The session Durable Object's Torn fetch path: retries, timeouts, error text
// and pagination budget. Runs in plain Node via the cloudflare:workers stub
// (vitest.config.ts); only the network (global fetch) and the rate limiter are faked.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TornMCP } from "./index.js";

const KEY = "AbCdEf0123456789";

type Reply = unknown | ((url: string, init?: RequestInit) => Promise<Response>);

let replies: Reply[];
let urls: string[];

function makeMcp(): any {
  const env = {
    RATE_LIMITER: {
      idFromName: (n: string) => n,
      get: () => ({ fetch: async () => Response.json({ limited: false, remaining: 99, resetMs: 1000 }) }),
    },
  };
  return new TornMCP({} as any, env as any);
}

beforeEach(() => {
  replies = [];
  urls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    urls.push(String(url));
    const next = replies.shift();
    if (next === undefined) throw new Error(`unexpected fetch ${url}`);
    if (typeof next === "function") return (next as any)(url, init);
    return Response.json(next);
  });
});

afterEach(() => vi.unstubAllGlobals());

const tornError = (code: number, error: string) => ({ error: { code, error } });

describe("Torn fetch path", () => {
  it("retries Torn error 17 (backend error), which arrives as HTTP 200", async () => {
    replies = [tornError(17, "Backend error"), { profile: { id: 1, name: "Bob" } }];
    const res = await makeMcp().callTorn(KEY, "user", "profile", undefined, undefined);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent.profile.name).toBe("Bob");
    expect(urls).toHaveLength(2);
  });

  it("does not retry error 5 (too many requests) and tells the user to wait", async () => {
    replies = [tornError(5, "Too many requests")];
    const res = await makeMcp().callTorn(KEY, "user", "profile", undefined, undefined);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Torn API error 5.*wait/i);
    expect(urls).toHaveLength(1);
  });

  it("gives a fix hint when the key's access level is too low", async () => {
    replies = [tornError(16, "Access level of this key is not high enough")];
    const res = await makeMcp().callTorn(KEY, "user", "profile", undefined, undefined);
    expect(res.content[0].text).toMatch(/Limited or Full/);
  });

  it("times out a Torn call that hangs, retries, then reports it", async () => {
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError"))),
      );
    replies = [hang, hang, hang];
    const mcp = makeMcp();
    mcp.fetchTimeoutMs = 20;
    const res = await mcp.callTorn(KEY, "user", "profile", undefined, undefined);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/did not answer|timed out/i);
    expect(urls).toHaveLength(3);
  });

  it("sends comment=torn-mcp and never the key anywhere but api.torn.com", async () => {
    replies = [{ profile: { id: 1 } }];
    await makeMcp().callTorn(KEY, "user", "profile", undefined, undefined);
    const u = new URL(urls[0]!);
    expect(u.host).toBe("api.torn.com");
    expect(u.searchParams.get("comment")).toBe("torn-mcp");
  });

  it("says why pagination stopped early, with the real Torn error", async () => {
    replies = [
      { attacks: [{ id: 1 }], _metadata: { links: { prev: "https://api.torn.com/v2/user/attacks?offset=100" } } },
      tornError(5, "Too many requests"),
    ];
    const res = await makeMcp().callTorn(KEY, "user", "attacks", undefined, undefined);
    expect(res.structuredContent._pages_partial).toMatch(/Torn API error 5/);
    expect(res.structuredContent._pages_partial).not.toMatch(/subrequest/);
  });

  it("re-fetches only one page when a time window comes back empty", async () => {
    const next = "https://api.torn.com/v2/user/attacks?offset=100";
    replies = [
      { attacks: [], _metadata: { links: {} } },
      { attacks: [{ id: 1, started: 1_700_000_000 }], _metadata: { links: { prev: next } } },
    ];
    const res = await makeMcp().callTorn(KEY, "user", "attacks", undefined, { from: "-1h" });
    expect(res.structuredContent.attacks).toHaveLength(1);
    expect(res.structuredContent._note).toMatch(/No results in the requested time window/);
    // Page 1 of the window, then page 1 of the widened call. No walk through history.
    expect(urls).toHaveLength(2);
  });
});
