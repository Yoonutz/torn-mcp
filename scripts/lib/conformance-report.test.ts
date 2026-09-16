// @license MIT
import { describe, it, expect } from "vitest";
import { buildMainReport, buildDevReport } from "./conformance-report.mjs";

// Minimal catalog stub.
const catalog = {
  openapiVersion: "6.0.0",
  tags: {
    user: {
      ammo: { path: "/user/ammo", requiresId: false },
      trade: { idPath: "/user/{tradeId}/trade", requiresId: true },
    },
  },
};

const DOCUMENTED_SKIPS = {
  "user/trade": "transient — tested when an active trade exists",
};

function makeResult(ep, status, extra = {}) {
  return { ep, status, reasons: [], evidence: {}, devFindings: [], ...extra };
}

describe("buildMainReport", () => {
  it("includes a header with the OpenAPI version and endpoint count", () => {
    const results = [makeResult("user/ammo", "pass")];
    const out = buildMainReport({
      catalog,
      results,
      pass: results,
      newDrift: [],
      knownDrift: [],
      resolved: [],
      notEvaluated: [],
      smells: [],
      skips: [],
      documentedSkips: [],
      unexpectedSkips: [],
      nowTestable: [],
      compileIssues: [],
      DOCUMENTED_SKIPS,
      compileOnly: false,
    });
    expect(out).toContain("# Torn conformance report");
    expect(out).toContain("6.0.0");
    expect(out).toContain("1 endpoints");
  });

  it("labels compile-check mode correctly", () => {
    const results = [makeResult("user/ammo", "compilable")];
    const out = buildMainReport({
      catalog,
      results,
      pass: [],
      newDrift: [],
      knownDrift: [],
      resolved: [],
      notEvaluated: [],
      smells: [],
      skips: [],
      documentedSkips: [],
      unexpectedSkips: [],
      nowTestable: [],
      compileIssues: [],
      DOCUMENTED_SKIPS,
      compileOnly: true,
    });
    expect(out).toContain("compile-check (no calls)");
  });

  it("surfaces new drift in a dedicated section", () => {
    const r = makeResult("user/ammo", "fail", { newReasons: ["missing required field 'ammo' (at (root))"] });
    const out = buildMainReport({
      catalog,
      results: [r],
      pass: [],
      newDrift: [r],
      knownDrift: [],
      resolved: [],
      notEvaluated: [],
      smells: [],
      skips: [],
      documentedSkips: [],
      unexpectedSkips: [],
      nowTestable: [],
      compileIssues: [],
      DOCUMENTED_SKIPS,
      compileOnly: false,
    });
    expect(out).toContain("NEW drift");
    expect(out).toContain("user/ammo");
    expect(out).toContain("missing required field");
  });

  it("surfaces resolved baseline entries", () => {
    const out = buildMainReport({
      catalog,
      results: [],
      pass: [],
      newDrift: [],
      knownDrift: [],
      resolved: [{ ep: "user/ammo", gone: ["wrong type at /ammo — schema expects array"] }],
      notEvaluated: [],
      smells: [],
      skips: [],
      documentedSkips: [],
      unexpectedSkips: [],
      nowTestable: [],
      compileIssues: [],
      DOCUMENTED_SKIPS,
      compileOnly: false,
    });
    expect(out).toContain("Resolved");
    expect(out).toContain("user/ammo");
  });

  it("lists expected skips with their documented reason", () => {
    const skip = makeResult("user/trade", "skip", { note: "Torn 6: Incorrect ID" });
    const out = buildMainReport({
      catalog,
      results: [skip],
      pass: [],
      newDrift: [],
      knownDrift: [],
      resolved: [],
      notEvaluated: [],
      smells: [],
      skips: [skip],
      documentedSkips: [skip],
      unexpectedSkips: [],
      nowTestable: [],
      compileIssues: [],
      DOCUMENTED_SKIPS,
      compileOnly: false,
    });
    expect(out).toContain("Expected skips");
    expect(out).toContain("user/trade");
    expect(out).toContain("transient");
  });
});

describe("buildDevReport", () => {
  const responseRef = () => null;

  it("includes the standard preamble", () => {
    const out = buildDevReport({
      catalog,
      results: [makeResult("user/ammo", "pass")],
      pass: [makeResult("user/ammo", "pass")],
      newDrift: [],
      knownDrift: [],
      skips: [],
      resolved: [],
      responseRef,
    });
    expect(out).toContain("# Torn API — OpenAPI spec vs live responses");
    expect(out).toContain("6.0.0");
  });

  it("lists mismatches with their spec path", () => {
    const r = makeResult("user/ammo", "fail", {
      newReasons: ["wrong type at /ammo"],
      reasons: ["wrong type at /ammo"],
    });
    const out = buildDevReport({
      catalog,
      results: [r],
      pass: [],
      newDrift: [r],
      knownDrift: [],
      skips: [],
      resolved: [],
      responseRef,
    });
    expect(out).toContain("/user/ammo");
    expect(out).toContain("wrong type at /ammo");
  });

  it("ends with a newline", () => {
    const out = buildDevReport({
      catalog,
      results: [],
      pass: [],
      newDrift: [],
      knownDrift: [],
      skips: [],
      resolved: [],
      responseRef,
    });
    expect(out.endsWith("\n")).toBe(true);
  });
});
