// @license MIT
import { describe, it, expect } from "vitest";
import { buildDevFindings } from "./dev-findings.mjs";

// ajv verbose-mode error shapes, minimal fields the builder uses.
const typeErr = (instancePath: string, type: string, data: unknown) => ({
  instancePath,
  keyword: "type",
  params: { type },
  data,
});

// Payloads carry `// <--` markers on the offending lines; strip to parse as JSON.
const parsePayload = (payload: string) =>
  JSON.parse(
    payload
      .split("\n")
      .map((l) => l.replace(/\s*\/\/ <--.*$/, ""))
      .join("\n"),
  );

describe("buildDevFindings", () => {
  it("builds a nested single-item sample for an array-item type error", () => {
    const json = {
      hof: [
        { id: 1517799, username: "Penicillin", position: 1, value: 4718046455504, rank: "#26 Invincible" },
        { id: 2, username: "Other", position: 2, value: 1, rank: "#1" },
      ],
    };
    const findings = buildDevFindings(json, [typeErr("/hof/0/value", "string", 4718046455504)]);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.statements).toEqual(["spec says `value` is string; API returns number (at `/hof/*/value`)"]);
    // the offending line is marked for first-time readers
    expect(f.payload!).toMatch(/"value": 4718046455504,? \/\/ <-- spec says string, API returns number/);
    const payload = parsePayload(f.payload!);
    // one item only, offending + identity fields kept
    expect(payload.hof).toHaveLength(1);
    expect(payload.hof[0].value).toBe(4718046455504);
    expect(payload.hof[0].id).toBe(1517799);
    expect(f.notes[0]).toBe("`value` is a number, not the documented string.");
  });

  it("keeps the whole branch for a deep object path", () => {
    const json = {
      personalstats: {
        attacking: { escapes: { player: 28, foes: 0 }, hits: 1 },
        other: { big: "x" },
      },
    };
    const findings = buildDevFindings(json, [
      {
        instancePath: "/personalstats/attacking",
        keyword: "required",
        params: { missingProperty: "escpaes" },
        data: json.personalstats.attacking,
      },
    ]);

    const f = findings[0];
    expect(f.statements).toEqual([
      "spec marks `escpaes` required (at `/personalstats/attacking`); the live response has no such field",
    ]);
    // missing field: the containing object's line is marked
    expect(f.payload!).toMatch(/"attacking": \{ \/\/ <-- spec expects "escpaes" here; the API never returns it/);
    const payload = parsePayload(f.payload!);
    expect(payload.personalstats.attacking.escapes).toEqual({ player: 28, foes: 0 });
    expect(payload.other).toBeUndefined();
    expect(f.notes[0]).toBe("No `escpaes` key anywhere on the object.");
  });

  it("reports enum violations with the live value", () => {
    const json = { missions: { rewards: [{ details: { type: "Weapon" } }] } };
    const findings = buildDevFindings(json, [
      {
        instancePath: "/missions/rewards/0/details/type",
        keyword: "enum",
        params: { allowedValues: ["Standard", "Tracer"] },
        data: "Weapon",
      },
    ]);

    const f = findings[0];
    expect(f.statements).toEqual([
      'spec allows only "Standard", "Tracer" at `/missions/rewards/*/details/type`; API returns "Weapon"',
    ]);
    expect(f.payload!).toMatch(/"type": "Weapon",? \/\/ <-- not one of the spec's allowed values/);
    expect(f.notes[0]).toBe('Live value "Weapon" is outside the documented enum.');
  });

  it("merges sibling errors into one finding with one payload", () => {
    const json = {
      stocks: [{ id: 1, bonus: { increment: null, progress: null, frequency: null, extra: 1 } }],
    };
    const findings = buildDevFindings(json, [
      typeErr("/stocks/0/bonus/increment", "integer", null),
      typeErr("/stocks/0/bonus/progress", "integer", null),
      typeErr("/stocks/0/bonus/frequency", "integer", null),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].statements).toHaveLength(3);
    // every offending sibling line gets its own marker
    expect(findings[0].payload!.match(/\/\/ <-- spec says integer, API returns null/g)).toHaveLength(3);
    const payload = parsePayload(findings[0].payload!);
    expect(payload.stocks[0].bonus.increment).toBeNull();
    expect(payload.stocks[0].bonus.progress).toBeNull();
    expect(payload.stocks[0].bonus.frequency).toBeNull();
  });

  it("collapses the same error across many array items into one finding", () => {
    const json = {
      hof: [
        { id: 1, username: "A", value: 100 },
        { id: 2, username: "B", value: 200 },
        { id: 3, username: "C", value: 300 },
      ],
    };
    const findings = buildDevFindings(json, [
      typeErr("/hof/0/value", "string", 100),
      typeErr("/hof/1/value", "string", 200),
      typeErr("/hof/2/value", "string", 300),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].statements).toHaveLength(1);
    const payload = parsePayload(findings[0].payload!);
    expect(payload.hof).toHaveLength(1);
    expect(payload.hof[0].id).toBe(1);
  });

  it("trims large sibling fields to stay within budget but always keeps the offending field", () => {
    const item: Record<string, unknown> = { id: 7, wanted: null };
    for (let i = 0; i < 50; i++) item[`filler_${i}`] = "x".repeat(40);
    const json = { things: [item] };
    const findings = buildDevFindings(json, [typeErr("/things/0/wanted", "object", null)], {
      budget: 300,
    });

    const f = findings[0];
    expect(f.payload!.length).toBeLessThanOrEqual(450); // budget + skeleton and marker slack
    const payload = parsePayload(f.payload!);
    expect(payload.things[0].wanted).toBeNull();
    expect(payload.things[0].id).toBe(7);
  });
});
