// @license MIT
import { describe, it, expect } from "vitest";
import {
  buildUrl,
  humanizeTimestamps,
  parseTornError,
  resolveEndpointPath,
  validateParams,
} from "./torn.js";

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

describe("validateParams", () => {
  it("flags a missing required param with allowed values", () => {
    const msg = validateParams("faction", "news", {});
    expect(msg).toMatch(/requires query param 'cat'/);
    expect(msg).toMatch(/armoryAction/);
  });
  it("rejects an invalid enum value with the allowed list", () => {
    const msg = validateParams("faction", "news", { cat: "armorynews" });
    expect(msg).toMatch(/Invalid 'cat'='armorynews'/);
    expect(msg).toMatch(/main/);
  });
  it("passes when the required enum value is valid", () => {
    expect(validateParams("faction", "news", { cat: "armoryAction" })).toBeNull();
  });
  it("returns null for endpoints with no required params", () => {
    expect(validateParams("torn", "timestamp", {})).toBeNull();
  });
});

describe("humanizeTimestamps", () => {
  const EPOCH = 1781471794;
  const ISO = new Date(EPOCH * 1000).toISOString().replace(".000Z", "Z");

  it("adds an ISO sibling for epoch timestamp fields, keeping the original", () => {
    const out = humanizeTimestamps({ timestamp: EPOCH }) as any;
    expect(out.timestamp).toBe(EPOCH);
    expect(out.timestamp_human).toBe(ISO);
  });
  it("handles *_at keys and nests into arrays/objects", () => {
    const out = humanizeTimestamps({
      crimes: [{ created_at: EPOCH, name: "x" }],
    }) as any;
    expect(out.crimes[0].created_at_human).toBe(ISO);
    expect(out.crimes[0].name).toBe("x");
  });
  it("ignores non-timestamp numbers and out-of-range ints", () => {
    const out = humanizeTimestamps({ level: 50, money: 999 }) as any;
    expect(out.level_human).toBeUndefined();
    expect(out.money_human).toBeUndefined();
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
