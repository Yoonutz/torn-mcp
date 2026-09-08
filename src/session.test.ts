// @license MIT
import { describe, it, expect } from "vitest";
import { isStaleSessionRequest, staleSessionResponse } from "./session.js";

const req = (headers: Record<string, string> = {}, method = "POST") =>
  new Request("https://mcp-session/mcp", { method, headers });

describe("isStaleSessionRequest", () => {
  it("is stale when a fresh DO (no transport) receives a request that names a session", () => {
    expect(isStaleSessionRequest(false, req({ "Mcp-Session-Id": "abc" }))).toBe(true);
    expect(isStaleSessionRequest(false, req({ "mcp-session-id": "abc" }, "GET"))).toBe(true);
    expect(isStaleSessionRequest(false, req({ "mcp-session-id": "abc" }, "DELETE"))).toBe(true);
  });

  it("is not stale for a first request without a session id (initialize)", () => {
    expect(isStaleSessionRequest(false, req())).toBe(false);
  });

  it("is not stale once the DO holds a live transport", () => {
    expect(isStaleSessionRequest(true, req({ "Mcp-Session-Id": "abc" }))).toBe(false);
  });
});

describe("staleSessionResponse", () => {
  it("is a 404 JSON-RPC 'Session not found' so clients re-initialize", async () => {
    const res = await staleSessionResponse(req({ "Mcp-Session-Id": "abc" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { jsonrpc: string; error: { code: number; message: string } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.code).toBe(-32001);
    expect(body.error.message).toMatch(/Session not found/);
  });

  it("drains the request body before answering (the runtime rejects unread bodies)", async () => {
    const request = new Request("https://mcp-session/mcp", {
      method: "POST",
      headers: { "Mcp-Session-Id": "abc" },
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    });
    await staleSessionResponse(request);
    expect(request.bodyUsed).toBe(true);
  });
});
