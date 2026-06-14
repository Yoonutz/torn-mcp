// @license MIT
import { describe, it, expect } from "vitest";
import { buildUrl, parseTornError, resolveEndpointPath } from "./torn.js";

describe("resolveEndpointPath", () => {
  it("resolves a plain endpoint", () => {
    expect(resolveEndpointPath("user", "bars")).toBe("/user/bars");
  });
  it("uses the id template when an id is supplied", () => {
    expect(resolveEndpointPath("user", "basic", "42")).toBe("/user/42/basic");
  });
  it("falls back to the non-id path when id omitted", () => {
    expect(resolveEndpointPath("user", "basic")).toBe("/user/basic");
  });
  it("encodes the id", () => {
    expect(resolveEndpointPath("faction", "basic", "1 2")).toBe(
      "/faction/1%202/basic",
    );
  });
  it("throws when an id-only endpoint is missing its id", () => {
    expect(() => resolveEndpointPath("user", "crimes")).toThrow(/requires an id/);
  });
  it("throws on unknown tag", () => {
    expect(() => resolveEndpointPath("nope", "bars")).toThrow(/Unknown tag/);
  });
  it("throws on unknown endpoint", () => {
    expect(() => resolveEndpointPath("user", "nope")).toThrow(/Unknown endpoint/);
  });
});

describe("buildUrl", () => {
  it("builds a fixed-host url with key", () => {
    expect(buildUrl("/torn/timestamp", undefined, "SECRET")).toBe(
      "https://api.torn.com/v2/torn/timestamp?key=SECRET",
    );
  });
  it("appends extra params", () => {
    const url = new URL(buildUrl("/user/log", { limit: 5, cat: "x" }, "K"));
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("cat")).toBe("x");
    expect(url.searchParams.get("key")).toBe("K");
  });
  it("always targets api.torn.com (SSRF guard)", () => {
    expect(new URL(buildUrl("/market/bazaar", undefined, "K")).host).toBe(
      "api.torn.com",
    );
  });
});

describe("parseTornError", () => {
  it("detects the Torn error envelope", () => {
    expect(
      parseTornError(JSON.stringify({ error: { code: 2, error: "Incorrect key" } })),
    ).toBe("Torn API error 2: Incorrect key");
  });
  it("returns null for normal payloads", () => {
    expect(parseTornError(JSON.stringify({ timestamp: 123 }))).toBeNull();
  });
  it("returns null for non-json", () => {
    expect(parseTornError("not json")).toBeNull();
  });
});
