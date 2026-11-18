// @license MIT
import { describe, it, expect } from "vitest";
import { assessBootstrap, decideExit, DEFAULT_MAX_UNEXPECTED_SKIPS } from "./conformance-gate.mjs";

const base = {
  compileOnly: false,
  keyPresent: true,
  requireKey: false,
  bootstrapError: null,
  newDrift: 0,
  unexpectedSkips: 0,
  tested: 180,
  skipped: 5,
  maxUnexpectedSkips: DEFAULT_MAX_UNEXPECTED_SKIPS,
};

describe("assessBootstrap", () => {
  it("names a rejected test key", () => {
    expect(assessBootstrap({ err: "Torn 2: Incorrect key" })).toMatch(/test key.*Torn 2/i);
  });
  it("flags a response with no user id", () => {
    expect(assessBootstrap({ json: {} })).toMatch(/no user id/i);
  });
  it("accepts a normal user/basic response", () => {
    expect(assessBootstrap({ json: { basic: { id: 1 } } })).toBeNull();
  });
});

describe("decideExit", () => {
  it("passes a healthy live run", () => {
    expect(decideExit(base)).toEqual({ exitCode: 0, problems: [] });
  });
  it("fails on new drift", () => {
    expect(decideExit({ ...base, newDrift: 2 }).exitCode).toBe(1);
  });
  it("fails when the test key was rejected, even with zero drift", () => {
    const out = decideExit({ ...base, bootstrapError: "test key rejected: Torn 2: Incorrect key" });
    expect(out.exitCode).toBe(1);
    expect(out.problems.join(" ")).toMatch(/Torn 2/);
  });
  it("fails when most endpoints were skipped (nothing really tested)", () => {
    const out = decideExit({ ...base, tested: 20, skipped: 170 });
    expect(out.exitCode).toBe(1);
    expect(out.problems.join(" ")).toMatch(/skipped/);
  });
  it("fails when unexpected skips pass the limit, not below it", () => {
    expect(decideExit({ ...base, unexpectedSkips: DEFAULT_MAX_UNEXPECTED_SKIPS }).exitCode).toBe(0);
    expect(decideExit({ ...base, unexpectedSkips: DEFAULT_MAX_UNEXPECTED_SKIPS + 1 }).exitCode).toBe(1);
  });
  it("fails a run that must be live but has no key", () => {
    const out = decideExit({ ...base, compileOnly: true, keyPresent: false, requireKey: true });
    expect(out.exitCode).toBe(1);
    expect(out.problems.join(" ")).toMatch(/TORN_TEST_API_KEY/);
  });
  it("lets an explicit local compile check pass without a key", () => {
    expect(decideExit({ ...base, compileOnly: true, keyPresent: false, requireKey: false }).exitCode).toBe(0);
  });
});
