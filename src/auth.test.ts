// @license MIT
import { describe, it, expect } from "vitest";
import { keyFromHeaders, KEY_HEADER, MISSING_KEY_ERROR } from "./auth.js";

describe("keyFromHeaders", () => {
  it("reads the key from the X-Torn-Api-Key header (case-insensitive)", () => {
    expect(keyFromHeaders(new Headers({ "X-Torn-Api-Key": "abc" }))).toBe("abc");
    expect(keyFromHeaders(new Headers({ [KEY_HEADER]: "abc" }))).toBe("abc");
  });

  it("falls back to the server key only when the header is absent", () => {
    expect(keyFromHeaders(new Headers(), "server")).toBe("server");
    expect(keyFromHeaders(new Headers({ "X-Torn-Api-Key": "abc" }), "server")).toBe("abc");
  });

  it("returns an empty string when no key is available", () => {
    expect(keyFromHeaders(new Headers())).toBe("");
    expect(keyFromHeaders(new Headers(), undefined)).toBe("");
  });

  it("never reads a key from the request URL query string", () => {
    // The Worker passes only headers here on purpose: a key in the URL would be
    // persisted by Cloudflare invocation logs, so it is not an accepted input.
    expect(keyFromHeaders(new Headers({ "X-Torn-Api-Key": "" }))).toBe("");
    expect(MISSING_KEY_ERROR).not.toMatch(/\?key=/);
    expect(MISSING_KEY_ERROR).toMatch(/X-Torn-Api-Key/);
  });
});

describe("keyFromHeaders - alternative header names", () => {
  // claude.ai custom connectors only send Anthropic-approved header names
  // (x-api-key, x-auth-token, authorization); a custom name like
  // x-torn-api-key is rejected at save time, so the Worker accepts these too.
  it("reads the key from x-api-key when X-Torn-Api-Key is absent", () => {
    expect(keyFromHeaders(new Headers({ "X-Api-Key": "abc" }))).toBe("abc");
  });

  it("reads the key from Authorization: Bearer when the others are absent", () => {
    expect(keyFromHeaders(new Headers({ Authorization: "Bearer abc" }))).toBe("abc");
    expect(keyFromHeaders(new Headers({ Authorization: "bearer abc" }))).toBe("abc");
  });

  it("ignores an Authorization header that is not a Bearer scheme", () => {
    expect(keyFromHeaders(new Headers({ Authorization: "Basic abc" }))).toBe("");
  });

  it("prefers X-Torn-Api-Key over x-api-key over Authorization", () => {
    const all = new Headers({ "X-Torn-Api-Key": "a", "X-Api-Key": "b", Authorization: "Bearer c" });
    expect(keyFromHeaders(all)).toBe("a");
    const two = new Headers({ "X-Api-Key": "b", Authorization: "Bearer c" });
    expect(keyFromHeaders(two)).toBe("b");
  });

  it("uses the alternatives before the server fallback", () => {
    expect(keyFromHeaders(new Headers({ "X-Api-Key": "abc" }), "server")).toBe("abc");
  });

  it("names the accepted headers in the missing-key error", () => {
    expect(MISSING_KEY_ERROR).toMatch(/X-Api-Key/);
  });
});

describe("keyFromHeaders - empty alternatives fall through", () => {
  it("treats an empty x-api-key as absent", () => {
    expect(keyFromHeaders(new Headers({ "X-Api-Key": "", Authorization: "Bearer c" }))).toBe("c");
    expect(keyFromHeaders(new Headers({ "X-Api-Key": "" }), "server")).toBe("server");
  });
});
