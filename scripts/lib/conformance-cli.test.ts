// @license MIT
// End-to-end runs of scripts/conformance.mjs in its no-network modes, so the
// main loop and the exit gate are exercised as CI runs them.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../conformance.mjs", import.meta.url));

function run(args: string[], env: Record<string, string>) {
  const clean = { ...process.env };
  delete clean.TORN_TEST_API_KEY;
  delete clean.GITHUB_STEP_SUMMARY;
  delete clean.CONFORMANCE_REQUIRE_KEY;
  return spawnSync(process.execPath, [script, ...args], { env: { ...clean, ...env }, encoding: "utf8" });
}

describe("conformance.mjs (no network)", () => {
  it("compiles every validator and exits 0 with --compile", () => {
    const r = run(["--compile"], {});
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/0 new drift failure/);
  }, 30_000);

  it("fails when CI requires a live run but the key is missing", () => {
    const r = run([], { CONFORMANCE_REQUIRE_KEY: "1" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/TORN_TEST_API_KEY is not set/);
  }, 30_000);

  it("allows an explicit --compile even when CI requires a key", () => {
    expect(run(["--compile"], { CONFORMANCE_REQUIRE_KEY: "1" }).status).toBe(0);
  }, 30_000);

  it("refuses to write a baseline from a compile-only run", () => {
    const r = run(["--compile", "--update-baseline"], {});
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Baseline NOT updated/);
  }, 30_000);
});
