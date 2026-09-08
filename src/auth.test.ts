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
