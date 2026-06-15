// @license MIT
import { describe, it, expect } from "vitest";
import { mergePages, isEmptyPayload, MAX_ITEMS, MAX_BYTES, MAX_PAGES } from "./enrich.js";
import { resolveTimeParams } from "./enrich.js";
import { followPages } from "./enrich.js";
import { filterByTimeWindow } from "./enrich.js";
import { truncate } from "./enrich.js";
import { annotate } from "./enrich.js";

describe("consts", () => {
  it("has the locked defaults", () => {
    expect(MAX_PAGES).toBe(3);
    expect(MAX_ITEMS).toBe(50);
    expect(MAX_BYTES).toBe(24_000);
  });
});

describe("mergePages", () => {
  it("concatenates array payloads and keeps the last _metadata", () => {
    const merged = mergePages([
      { attacks: [{ id: 1 }], _metadata: { links: { prev: "p1" } } },
      { attacks: [{ id: 2 }], _metadata: { links: { prev: "p2" } } },
    ]);
    expect(merged.attacks).toEqual([{ id: 1 }, { id: 2 }]);
    expect(merged._metadata).toEqual({ links: { prev: "p2" } });
    expect(merged._pages_fetched).toBe(2);
  });

  it("shallow-merges object-map payloads", () => {
    const merged = mergePages([
      { log: { a: { x: 1 } }, _metadata: {} },
      { log: { b: { y: 2 } }, _metadata: {} },
    ]);
    expect(merged.log).toEqual({ a: { x: 1 }, b: { y: 2 } });
    expect(merged._pages_fetched).toBe(2);
  });

  it("marks a single page as one fetched", () => {
    const merged = mergePages([{ attacks: [{ id: 1 }], _metadata: {} }]);
    expect(merged._pages_fetched).toBe(1);
    expect(merged.attacks).toEqual([{ id: 1 }]);
  });
});

describe("isEmptyPayload", () => {
  it("is true for an empty array payload", () => {
    expect(isEmptyPayload({ attacks: [], _metadata: {} })).toBe(true);
  });
  it("is true for an empty object-map payload", () => {
    expect(isEmptyPayload({ log: {}, _metadata: {} })).toBe(true);
  });
  it("is false when items are present", () => {
    expect(isEmptyPayload({ attacks: [{ id: 1 }] })).toBe(false);
  });
});

describe("resolveTimeParams", () => {
  // Fixed clock: 2001-09-09T01:46:40Z → nowSec 1_000_000_000, now ms = that * 1000.
  const NOW_MS = 1_000_000_000 * 1000;

  it("converts each relative unit to integer Unix seconds", () => {
    expect(resolveTimeParams({ from: "-30m" }, NOW_MS).from).toBe(1_000_000_000 - 1800);
    expect(resolveTimeParams({ from: "-3h" }, NOW_MS).from).toBe(1_000_000_000 - 10800);
    expect(resolveTimeParams({ from: "-3hr" }, NOW_MS).from).toBe(1_000_000_000 - 10800);
    expect(resolveTimeParams({ from: "-2d" }, NOW_MS).from).toBe(1_000_000_000 - 172800);
    expect(resolveTimeParams({ from: "-1w" }, NOW_MS).from).toBe(1_000_000_000 - 604800);
  });

  it("resolves today and yesterday to UTC midnight", () => {
    const startOfToday = Math.floor(Date.UTC(2001, 8, 9) / 1000);
    expect(resolveTimeParams({ from: "today" }, NOW_MS).from).toBe(startOfToday);
    expect(resolveTimeParams({ from: "yesterday" }, NOW_MS).from).toBe(startOfToday - 86400);
  });

  it("passes integers through (floored) and leaves other params untouched", () => {
    const out = resolveTimeParams({ from: 1700000000, to: "1699999999", cat: "main" }, NOW_MS);
    expect(out.from).toBe(1700000000);
    expect(out.to).toBe(1699999999);
    expect(out.cat).toBe("main");
  });

  it("leaves an unparseable token as-is", () => {
    expect(resolveTimeParams({ from: "-3x" }, NOW_MS).from).toBe("-3x");
  });
});

describe("followPages", () => {
  it("follows the prev direction (newest-first lists) up to max", async () => {
    const pages: Record<string, any> = {
      "url-p2": { attacks: [{ id: 2 }], _metadata: { links: { prev: "url-p3" } } },
      "url-p3": { attacks: [{ id: 3 }], _metadata: { links: { prev: null } } },
    };
    const first = { attacks: [{ id: 1 }], _metadata: { links: { next: null, prev: "url-p2" } } };
    const fetchUrl = async (url: string) => pages[url];
    const { merged, partial } = await followPages(first, fetchUrl, 3);
    expect(merged.attacks).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(partial).toBe(false);
    expect(merged._pages_fetched).toBe(3);
  });

  it("follows the next direction when present", async () => {
    const pages: Record<string, any> = {
      "n2": { attacks: [{ id: 2 }], _metadata: { links: { next: null } } },
    };
    const first = { attacks: [{ id: 1 }], _metadata: { links: { next: "n2", prev: null } } };
    const { merged } = await followPages(first, async (u: string) => pages[u], 3);
    expect(merged.attacks).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("stops at the max page cap", async () => {
    const ever = (id: number): any => ({
      attacks: [{ id }],
      _metadata: { links: { prev: "more" } },
    });
    const first = ever(1);
    const { merged } = await followPages(first, async () => ever(9), 2);
    expect(merged._pages_fetched).toBe(2); // first + one follow only
  });

  it("returns partial data when a follow throws mid-walk", async () => {
    const first = { attacks: [{ id: 1 }], _metadata: { links: { prev: "boom" } } };
    const fetchUrl = async () => { throw new Error("rate limited"); };
    const { merged, partial } = await followPages(first, fetchUrl, 3);
    expect(partial).toBe(true);
    expect(merged.attacks).toEqual([{ id: 1 }]);
  });
});

describe("filterByTimeWindow", () => {
  it("keeps only items inside the window", () => {
    const data = { attacks: [{ id: 1, started: 100 }, { id: 2, started: 200 }], _metadata: {} };
    const out = filterByTimeWindow(data, { from: 150 });
    expect(out.attacks).toEqual([{ id: 2, started: 200 }]);
    expect(out._note).toBeUndefined();
  });

  it("restores the unfiltered set with a note when none are in window", () => {
    const data = { attacks: [{ id: 1, started: 100 }], _metadata: {} };
    const out = filterByTimeWindow(data, { from: 500 });
    expect(out.attacks).toEqual([{ id: 1, started: 100 }]);
    expect(out._note).toMatch(/most recent/);
  });

  it("adds a note when the list is already empty", () => {
    const data = { attacks: [], _metadata: {} };
    const out = filterByTimeWindow(data, { from: 500 });
    expect(out.attacks).toEqual([]);
    expect(out._note).toMatch(/most recent/);
  });

  it("fails open: keeps items with no detectable time field", () => {
    const data = { rows: [{ id: 1, label: "x" }], _metadata: {} };
    const out = filterByTimeWindow(data, { from: 500 });
    expect(out.rows).toEqual([{ id: 1, label: "x" }]);
    expect(out._note).toBeUndefined();
  });

  it("is a no-op when no window is given", () => {
    const data = { attacks: [{ id: 1, started: 100 }] };
    expect(filterByTimeWindow(data, {})).toBe(data);
  });

  it("applies a to-only upper bound", () => {
    const data = { attacks: [{ id: 1, started: 100 }, { id: 2, started: 300 }], _metadata: {} };
    const out = filterByTimeWindow(data, { to: 200 });
    expect(out.attacks).toEqual([{ id: 1, started: 100 }]);
    expect(out._note).toBeUndefined();
  });

  it("applies both bounds (inclusive range)", () => {
    const data = {
      attacks: [{ id: 1, started: 100 }, { id: 2, started: 200 }, { id: 3, started: 300 }],
      _metadata: {},
    };
    const out = filterByTimeWindow(data, { from: 150, to: 250 });
    expect(out.attacks).toEqual([{ id: 2, started: 200 }]);
  });

  it("uses the regex fallback for an in-range time-ish key", () => {
    const data = { rows: [{ id: 1, attack_time: 1_500_000_000 }, { id: 2, attack_time: 1_000_000_000 }], _metadata: {} };
    const out = filterByTimeWindow(data, { from: 1_400_000_000 });
    expect(out.rows).toEqual([{ id: 1, attack_time: 1_500_000_000 }]);
  });

  it("ignores a time-ish key whose value is out of epoch range (fail-open keep)", () => {
    const data = { rows: [{ id: 1, time_rank: 5 }], _metadata: {} };
    const out = filterByTimeWindow(data, { from: 1_400_000_000 });
    expect(out.rows).toEqual([{ id: 1, time_rank: 5 }]);
    expect(out._note).toBeUndefined();
  });
});

describe("truncate", () => {
  it("caps a list to maxItems and records the receipt", () => {
    const attacks = Array.from({ length: 60 }, (_v, i) => ({ id: i }));
    const out = truncate({ attacks, _metadata: {} }, { maxItems: 50, maxBytes: 1_000_000 });
    expect(out.attacks).toHaveLength(50);
    expect(out._truncated).toEqual({ items_omitted: 10 });
  });

  it("shrinks further to honor the byte cap", () => {
    const attacks = Array.from({ length: 50 }, (_v, i) => ({ id: i, blob: "x".repeat(200) }));
    const out = truncate({ attacks }, { maxItems: 50, maxBytes: 2_000 });
    expect(out.attacks.length).toBeLessThan(50);
    expect(out._truncated.items_omitted).toBeGreaterThan(0);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(2_000);
  });

  it("leaves a small payload untouched", () => {
    const data = { attacks: [{ id: 1 }] };
    const out = truncate(data, { maxItems: 50, maxBytes: 1_000_000 });
    expect(out._truncated).toBeUndefined();
    expect(out.attacks).toEqual([{ id: 1 }]);
  });

  it("drops the largest non-underscore field for an oversized object payload", () => {
    const data = {
      money: { wallet: 1, big: "x".repeat(5_000), small: "y" },
    };
    const out = truncate(data, { maxItems: 50, maxBytes: 500 });
    // Non-array payload → dropLargestFields path. The biggest field is dropped.
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(500);
    expect(out._truncated.fields_dropped).toContain("money");
  });

  it("leaves a small non-array object payload untouched", () => {
    const data = { money: { wallet: 1, vault: 2 } };
    const out = truncate(data, { maxItems: 50, maxBytes: 1_000_000 });
    expect(out._truncated).toBeUndefined();
    expect(out.money).toEqual({ wallet: 1, vault: 2 });
  });
});

describe("annotate", () => {
  it("computes total_cash for user/money", () => {
    const data = {
      money: {
        wallet: 100, vault: 200, company: 50, cayman_bank: 1000,
        city_bank: { amount: 500 }, faction: { money: 25 },
        points: 999, daily_networth: 1_000_000,
      },
    };
    const out = annotate("user", "money", data);
    expect(out.money._computed.total_cash).toBe(1875); // 100+200+50+1000+500+25
    expect(out.money._computed.breakdown).toMatch(/wallet/);
    expect(out.money._computed.excluded).toMatch(/points/);
  });

  it("rewrites epoch timestamps to TCT with an _epoch sibling", () => {
    const out = annotate("user", "profile", { profile: { signed_up: 1_600_000_000 } });
    expect(out.profile.signed_up).toMatch(/^\d{2}:\d{2}:\d{2} - \d{2}\/\d{2}\/\d{2}$/);
    expect(out.profile.signed_up_epoch).toBe(1_600_000_000);
  });

  it("is a no-op annotation for an endpoint with no registry entry", () => {
    const out = annotate("torn", "items", { items: [{ id: 1 }] });
    expect(out.items).toEqual([{ id: 1 }]);
  });

  it("computes total_cash fail-soft when faction and city_bank are absent", () => {
    const data = { money: { wallet: 100, vault: 200, cayman_bank: 50 } };
    const out = annotate("user", "money", data);
    expect(out.money._computed.total_cash).toBe(350); // 100+200+50, no faction/city_bank/company
  });
});
