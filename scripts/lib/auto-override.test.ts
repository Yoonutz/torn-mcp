// @license MIT
import { describe, it, expect } from "vitest";
import { shouldAutoOverride } from "./auto-override.mjs";

describe("shouldAutoOverride", () => {
  it("overrides when the spec's container type is wrong for a key it defines", () => {
    const spec = [{ name: "stocks", type: "object", fields: ["1", "2"] }];
    const live = [{ name: "stocks", type: "array", fields: ["id", "name"] }];
    expect(shouldAutoOverride(spec, live)).toBe(true);
  });

  it("never overrides when the live key set differs from the spec (account-dependent shape)", () => {
    const spec = [{ name: "competition", type: "oneOf" }];
    const live = [
      { name: "name", type: "string" },
      { name: "score", type: "number" },
    ];
    expect(shouldAutoOverride(spec, live)).toBe(false);
  });

  it("never overrides a union-typed key (oneOf/anyOf): the schema already allows several shapes", () => {
    const spec = [{ name: "job", type: "oneOf" }];
    expect(shouldAutoOverride(spec, [{ name: "job", type: "object", fields: ["id"] }])).toBe(false);
    expect(shouldAutoOverride([{ name: "job", type: "anyOf" }], [{ name: "job", type: "array" }])).toBe(false);
  });

  it("does not override when the shapes agree", () => {
    const spec = [{ name: "items", type: "array", fields: ["id"] }];
    const live = [{ name: "items", type: "array", fields: ["id", "name"] }];
    expect(shouldAutoOverride(spec, live)).toBe(false);
  });

  it("does not override on missing input", () => {
    expect(shouldAutoOverride(undefined, [{ name: "x", type: "array" }])).toBe(false);
    expect(shouldAutoOverride([{ name: "x", type: "array" }], null)).toBe(false);
  });
});
