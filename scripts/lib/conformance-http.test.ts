// @license MIT
import { describe, it, expect } from "vitest";
import { buildTornUrl, fetchTornJson, CONFORMANCE_COMMENT } from "./conformance-http.mjs";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("buildTornUrl", () => {
  it("targets api.torn.com/v2 with the key and a log comment", () => {
    const u = new URL(buildTornUrl("/user/basic", { limit: 5 }, "K"));
    expect(u.origin + u.pathname).toBe("https://api.torn.com/v2/user/basic");
    expect(u.searchParams.get("key")).toBe("K");
    expect(u.searchParams.get("limit")).toBe("5");
    expect(u.searchParams.get("comment")).toBe(CONFORMANCE_COMMENT);
  });
});

describe("fetchTornJson", () => {
  it("returns parsed JSON", async () => {
    const out = await fetchTornJson("https://api.torn.com/v2/x", { fetchImpl: async () => json({ a: 1 }) });
    expect(out).toMatchObject({ json: { a: 1 }, status: 200 });
    expect(out.err).toBeUndefined();
  });
  it("turns a Torn error envelope into err", async () => {
    const out = await fetchTornJson("u", { fetchImpl: async () => json({ error: { code: 2, error: "Incorrect key" } }) });
    expect(out.err).toBe("Torn 2: Incorrect key");
  });
  it("reports HTTP errors with the status", async () => {
    const out = await fetchTornJson("u", { fetchImpl: async () => new Response("<html>bad gateway</html>", { status: 502 }) });
    expect(out.err).toMatch(/HTTP 502/);
    expect(out.status).toBe(502);
  });
  it("reports a non-JSON 200 body plainly", async () => {
    const out = await fetchTornJson("u", { fetchImpl: async () => new Response("a,b\n1,2", { status: 200 }) });
    expect(out.err).toMatch(/non-JSON/);
  });
  it("times out a call that hangs", async () => {
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new DOMException("t", "TimeoutError"))),
      );
    const out = await fetchTornJson("u", { fetchImpl: hang as any, timeoutMs: 20 });
    expect(out.err).toMatch(/timed out after 0?\.?\d*s|timed out/i);
  });
  it("never puts the key in an error message", async () => {
    const out = await fetchTornJson("https://api.torn.com/v2/x?key=SECRETKEY123", {
      fetchImpl: async () => {
        throw new TypeError("fetch failed for https://api.torn.com/v2/x?key=SECRETKEY123");
      },
    });
    expect(out.err).not.toContain("SECRETKEY123");
  });
});
