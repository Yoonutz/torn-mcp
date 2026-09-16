// @license MIT
import { describe, it, expect } from "vitest";
import { SEEDS, PARAM_SEEDS, PARAM_OVERRIDES, DOCUMENTED_SKIPS } from "./conformance-seeds.mjs";

describe("conformance-seeds", () => {
  describe("SEEDS", () => {
    it("every entry has a valid kind", () => {
      const validKinds = new Set(["const", "item", "list"]);
      for (const [ep, seed] of Object.entries(SEEDS)) {
        expect(validKinds.has(seed.kind), `${ep}: unknown kind '${seed.kind}'`).toBe(true);
      }
    });

    it("const seeds carry a string value", () => {
      for (const [ep, seed] of Object.entries(SEEDS)) {
        if (seed.kind === "const") {
          expect(typeof seed.value, `${ep}: const value must be a string`).toBe("string");
        }
      }
    });

    it("list seeds carry a string source", () => {
      for (const [ep, seed] of Object.entries(SEEDS)) {
        if (seed.kind === "list") {
          expect(typeof seed.source, `${ep}: list source must be a string`).toBe("string");
          expect(seed.source.includes("/"), `${ep}: list source must be tag/name`).toBe(true);
        }
      }
    });

    it("keys follow the tag/name pattern", () => {
      for (const ep of Object.keys(SEEDS)) {
        const parts = ep.split("/");
        expect(parts.length, `${ep}: key must be tag/name`).toBe(2);
        expect(parts[0].length, `${ep}: tag must be non-empty`).toBeGreaterThan(0);
        expect(parts[1].length, `${ep}: name must be non-empty`).toBeGreaterThan(0);
      }
    });
  });

  describe("PARAM_SEEDS", () => {
    it("every entry has a param and source", () => {
      for (const [ep, seed] of Object.entries(PARAM_SEEDS)) {
        expect(typeof seed.param, `${ep}: param must be a string`).toBe("string");
        expect(typeof seed.source, `${ep}: source must be a string`).toBe("string");
      }
    });
  });

  describe("PARAM_OVERRIDES", () => {
    it("every entry is a non-empty object", () => {
      for (const [ep, overrides] of Object.entries(PARAM_OVERRIDES)) {
        expect(typeof overrides, `${ep}: overrides must be an object`).toBe("object");
        expect(Object.keys(overrides).length, `${ep}: overrides must be non-empty`).toBeGreaterThan(0);
      }
    });
  });

  describe("DOCUMENTED_SKIPS", () => {
    it("every reason is a non-empty string", () => {
      for (const [ep, reason] of Object.entries(DOCUMENTED_SKIPS)) {
        expect(typeof reason, `${ep}: reason must be a string`).toBe("string");
        expect(reason.length, `${ep}: reason must be non-empty`).toBeGreaterThan(0);
      }
    });

    it("keys follow the tag/name pattern", () => {
      for (const ep of Object.keys(DOCUMENTED_SKIPS)) {
        const parts = ep.split("/");
        expect(parts.length, `${ep}: key must be tag/name`).toBe(2);
      }
    });
  });
});
