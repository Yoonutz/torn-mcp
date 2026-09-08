// @license MIT
import { describe, it, expect } from "vitest";
import { renderToolTable, syncReadme, TOOLS_START, TOOLS_END } from "./readme.mjs";

const catalog = {
  tagList: ["property", "user"],
  endpoints: 5,
  rawOps: 7,
  openapiVersion: "6.13.1",
  tags: {
    user: { profile: {}, bars: {}, money: {}, events: {} },
    property: { property: {} },
  },
};

describe("renderToolTable", () => {
  it("renders one row per tag, largest first, with real counts and example endpoints", () => {
    const table = renderToolTable(catalog);
    expect(table).toMatch(/\| `torn_user` +\| 4 +\| `profile`, `bars`, `money`, `events` +\|/);
    expect(table).toMatch(/\| `torn_property` +\| 1 +\| `property` +\|/);
    expect(table.indexOf("torn_user")).toBeLessThan(table.indexOf("torn_property"));
    expect(table).toMatch(/\| `torn_list_endpoints` \| — +\| discovery: lists every endpoint per tag \|/);
  });

  it("pads columns Prettier-style so formatting the README is a no-op", () => {
    const lines = renderToolTable(catalog).split("\n");
    const width = lines[0].length;
    for (const l of lines) expect(l.length, l).toBe(width);
    expect(lines[1]).toMatch(/^\| -+ \| -+ \| -+ \|$/);
  });
});

describe("syncReadme", () => {
  it("replaces only the marked block and the count sentence", () => {
    const before = [
      "intro covering all 999 endpoints across 999 operations of the spec",
      TOOLS_START,
      "stale table",
      TOOLS_END,
      "outro",
    ].join("\n");
    const after = syncReadme(before, catalog);
    expect(after).toMatch(/\| `torn_user` +\| 4 +\|/);
    expect(after).not.toContain("stale table");
    expect(after).toContain("covering all 5 endpoints across 7 operations of the spec");
    expect(after.startsWith("intro")).toBe(true);
    expect(after.endsWith("outro")).toBe(true);
  });

  it("preserves CRLF line endings and is idempotent", () => {
    const before = ["intro", TOOLS_START, "stale", TOOLS_END, "outro"].join("\r\n");
    const once = syncReadme(before, catalog);
    expect(once).not.toMatch(/[^\r]\n/);
    expect(syncReadme(once, catalog)).toBe(once);
  });

  it("throws when the markers are missing, so a hand-edited README cannot silently drift", () => {
    expect(() => syncReadme("no markers here", catalog)).toThrow(/tools:start/);
  });
});
