// @license MIT
import { describe, it, expect } from "vitest";
import { reconcileBaseline } from "./conformance-baseline.mjs";

const baseline = {
  "user/competition": ["missing required field 'competition' (at (root))"],
  "user/stocks": ["wrong type at /stocks/*/bonus/increment — schema expects integer"],
};

describe("reconcileBaseline", () => {
  it("never resolves anything in compile-only mode (no calls were made)", () => {
    const results = [
      { ep: "user/competition", status: "compilable" },
      { ep: "user/stocks", status: "compilable" },
    ];
    const r = reconcileBaseline(results, baseline, { compileOnly: true });
    expect(r.resolved).toEqual([]);
    expect(r.newDrift).toEqual([]);
    expect(r.knownDrift).toEqual([]);
    expect(r.notEvaluated.map((x) => x.ep).sort()).toEqual(["user/competition", "user/stocks"]);
  });

  it("resolves a baseline entry only when the endpoint passed at runtime", () => {
    const results = [
      { ep: "user/competition", status: "pass", reasons: [] },
      { ep: "user/stocks", status: "fail", reasons: baseline["user/stocks"] },
    ];
    const r = reconcileBaseline(results, baseline, { compileOnly: false });
    expect(r.resolved).toEqual([{ ep: "user/competition", gone: baseline["user/competition"] }]);
    expect(r.knownDrift.map((x) => x.ep)).toEqual(["user/stocks"]);
    expect(r.newDrift).toEqual([]);
  });

  it("resolves the specific reasons that disappeared from a still-failing endpoint", () => {
    const results = [
      { ep: "user/competition", status: "fail", reasons: ["wrong type at /competition — schema expects object"] },
      { ep: "user/stocks", status: "fail", reasons: baseline["user/stocks"] },
    ];
    const r = reconcileBaseline(results, baseline, { compileOnly: false });
    expect(r.resolved).toEqual([{ ep: "user/competition", gone: baseline["user/competition"] }]);
    expect(r.newDrift.map((x) => x.ep)).toEqual(["user/competition"]);
    expect(r.newDrift[0].newReasons).toEqual(["wrong type at /competition — schema expects object"]);
  });

  it("treats a skipped endpoint as not evaluated, never as resolved", () => {
    const results = [
      { ep: "user/competition", status: "skip", note: "Torn 6: Incorrect ID" },
      { ep: "user/stocks", status: "fail", reasons: baseline["user/stocks"] },
    ];
    const r = reconcileBaseline(results, baseline, { compileOnly: false });
    expect(r.resolved).toEqual([]);
    expect(r.notEvaluated).toEqual([{ ep: "user/competition", why: "skip: Torn 6: Incorrect ID" }]);
  });

  it("treats a baseline endpoint missing from the results as not evaluated", () => {
    const r = reconcileBaseline([{ ep: "user/stocks", status: "pass", reasons: [] }], baseline, {
      compileOnly: false,
    });
    expect(r.resolved).toEqual([{ ep: "user/stocks", gone: baseline["user/stocks"] }]);
    expect(r.notEvaluated).toEqual([{ ep: "user/competition", why: "not in this run" }]);
  });

  it("matches baseline reasons loosely (case, dashes, spacing)", () => {
    const results = [
      { ep: "user/stocks", status: "fail", reasons: ["Wrong type at /stocks/*/bonus/increment - schema expects  integer"] },
    ];
    const r = reconcileBaseline(results, { "user/stocks": baseline["user/stocks"] }, { compileOnly: false });
    expect(r.knownDrift.map((x) => x.ep)).toEqual(["user/stocks"]);
    expect(r.newDrift).toEqual([]);
    expect(r.resolved).toEqual([]);
  });
});
