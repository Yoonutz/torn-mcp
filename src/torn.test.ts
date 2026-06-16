// @license MIT
import { describe, it, expect } from "vitest";
import {
  buildUrl,
  endpointBadges,
  ensureKey,
  humanizeTimestamps,
  paramsHint,
  parseTornError,
  resolveEndpointPath,
  returnsHint,
  validateParams,
} from "./torn.js";
import { ENDPOINTS } from "./generated/endpoints.js";

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
    expect(msg).toMatch(/Invalid cat value 'armorynews'/);
    expect(msg).toMatch(/main/);
  });
  it("passes when the required enum value is valid", () => {
    expect(validateParams("faction", "news", { cat: "armoryAction" })).toBeNull();
  });
  it("accepts a comma-separated list of valid enum values", () => {
    expect(
      validateParams("faction", "news", { cat: "armoryAction,armoryDeposit" }),
    ).toBeNull();
  });
  it("flags only the invalid token in a comma-separated list", () => {
    const msg = validateParams("faction", "news", { cat: "armoryAction,drugs" });
    expect(msg).toMatch(/Invalid cat value 'drugs'/);
    expect(msg).not.toMatch(/armoryAction'/);
  });
  it("returns null for endpoints with no required params", () => {
    expect(validateParams("torn", "timestamp", {})).toBeNull();
  });
  it("rejects a non-numeric id for an integer-id endpoint", () => {
    expect(validateParams("market", "itemmarket", {}, "xanax")).toMatch(
      /must be a numeric Torn id/,
    );
  });
  it("accepts a numeric id for an integer-id endpoint", () => {
    expect(validateParams("market", "itemmarket", {}, "206")).toBeNull();
  });
});

describe("paramsHint", () => {
  it("surfaces optional enum params as a filter (incl. Drug)", () => {
    const hint = paramsHint(ENDPOINTS.user.inventory);
    expect(hint).toMatch(/filter cat=/);
    expect(hint).toMatch(/Drug/);
  });
  it("shows required enum params", () => {
    expect(paramsHint(ENDPOINTS.faction.news)).toMatch(/requires cat=/);
  });
});

describe("returnsHint", () => {
  it("lists the top-level response key", () => {
    expect(returnsHint(ENDPOINTS.user.ammo)).toBe(" → returns: ammo");
  });
  it("omits nested field names (those live in the catalog)", () => {
    expect(returnsHint(ENDPOINTS.user.ammo)).not.toMatch(/types/);
  });
  it("reports selection-based endpoints as varying", () => {
    const sel = { selectionBased: true, requiresId: false, query: [] } as any;
    expect(returnsHint(sel)).toBe(" → returns: varies by selection");
  });
  it("returns empty when no response shape is known", () => {
    const none = { requiresId: false, query: [] } as any;
    expect(returnsHint(none)).toBe("");
  });
});

describe("reality-corrected returns (spec drift overrides)", () => {
  it("unwraps faction/raidreport from array to the real object", () => {
    const def = ENDPOINTS.faction.raidreport as any;
    expect(def.returns[0]).toMatchObject({ name: "raidreport", type: "object" });
    expect(def.returnsNote).toMatch(/single object/);
  });
  it("corrects faction/territorywarreport to an object", () => {
    const def = ENDPOINTS.faction.territorywarreport as any;
    expect(def.returns[0].type).toBe("object");
    expect(def.returns[0].fields).toContain("factions");
  });
  it("wraps market/auctionhouselisting under its real envelope key", () => {
    const def = ENDPOINTS.market.auctionhouselisting as any;
    expect(def.returns[0].name).toBe("auctionhouselisting");
    expect(returnsHint(def)).toBe(" → returns: auctionhouselisting");
  });
  it("uses the real car fields for user/enlistedcars (not the spec's 'name')", () => {
    const def = ENDPOINTS.user.enlistedcars as any;
    const fields = def.returns[0].fields as string[];
    expect(fields).toContain("car_name");
    expect(fields).toContain("car_item_name");
    expect(fields).not.toContain("name");
  });
});

describe("endpointBadges", () => {
  const def = (keyLevel?: string, stability?: string) =>
    ({ keyLevel, stability, requiresId: false, query: [] }) as any;
  it("shows a non-public key level", () => {
    expect(endpointBadges(def("limited", "Stable"))).toBe(" [key: limited]");
  });
  it("hides the default public key level", () => {
    expect(endpointBadges(def("public", "Stable"))).toBe("");
  });
  it("flags unstable endpoints", () => {
    expect(endpointBadges(def("public", "Unstable"))).toBe(" ⚠ unstable");
  });
});

describe("humanizeTimestamps", () => {
  // 2026-06-13 15:54:10 UTC → Torn City Time log format.
  const EPOCH = 1781366050;
  const TCT = "15:54:10 - 13/06/26";

  it("keeps the canonical epoch and adds a <key>_human sibling", () => {
    const out = humanizeTimestamps({ timestamp: EPOCH }) as any;
    expect(out.timestamp).toBe(EPOCH);
    expect(out.timestamp_human).toBe(TCT);
  });
  it("handles *_at keys and nests into arrays/objects", () => {
    const out = humanizeTimestamps({
      crimes: [{ created_at: EPOCH, name: "x" }],
    }) as any;
    expect(out.crimes[0].created_at).toBe(EPOCH);
    expect(out.crimes[0].created_at_human).toBe(TCT);
    expect(out.crimes[0].name).toBe("x");
  });
  it("ignores non-timestamp numbers and out-of-range ints", () => {
    const out = humanizeTimestamps({ level: 50, money: 999 }) as any;
    expect(out.level).toBe(50);
    expect(out.level_human).toBeUndefined();
    expect(out.money_human).toBeUndefined();
  });
});

describe("humanizeTimestamps (widened keys)", () => {
  const TCT = /^\d{2}:\d{2}:\d{2} - \d{2}\/\d{2}\/20$/; // HH:MM:SS - DD/MM/YY, year 2020

  it("adds _human siblings for bare Torn v2 time fields, keeping the epoch", () => {
    const out = humanizeTimestamps({
      started: 1_600_000_000, ended: 1_600_000_100, executed: 1_600_000_200,
    }) as Record<string, unknown>;
    expect(out.started).toBe(1_600_000_000);
    expect(out.started_human).toMatch(TCT);
    expect(out.ended_human).toMatch(TCT);
    expect(out.executed_human).toMatch(TCT);
  });

  it("keeps the canonical key and adds the sibling", () => {
    const out = humanizeTimestamps({ timestamp: 1_600_000_000, signed_up: 1_600_000_000 }) as Record<string, unknown>;
    expect(out.timestamp).toBe(1_600_000_000);
    expect(out.timestamp_human).toMatch(TCT);
    expect(out.signed_up_human).toMatch(TCT);
  });
});

describe("ensureKey", () => {
  it("appends the key to a keyless URL", () => {
    expect(ensureKey("https://api.torn.com/v2/user/log?limit=2", "SECRET"))
      .toBe("https://api.torn.com/v2/user/log?limit=2&key=SECRET");
  });
  it("overwrites an existing key param", () => {
    expect(ensureKey("https://api.torn.com/v2/user/log?key=OLD", "NEW"))
      .toBe("https://api.torn.com/v2/user/log?key=NEW");
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
