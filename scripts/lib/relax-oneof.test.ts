// @license MIT
import { describe, it, expect } from "vitest";
import { relaxOverlappingOneOf } from "./relax-oneof.mjs";

function specWith(target) {
  return {
    components: {
      schemas: {
        Target: target,
        StringEnum: { type: "string", enum: ["a", "b"] },
        ObjA: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        ObjB: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
        ObjClosed: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
  };
}

describe("relaxOverlappingOneOf", () => {
  it("rewrites a bare string alongside a string enum to anyOf", () => {
    const spec = specWith({ oneOf: [{ $ref: "#/components/schemas/StringEnum" }, { type: "string" }] });
    const out = relaxOverlappingOneOf(spec);
    expect(out.components.schemas.Target.oneOf).toBeUndefined();
    expect(out.components.schemas.Target.anyOf).toEqual([
      { $ref: "#/components/schemas/StringEnum" },
      { type: "string" },
    ]);
  });

  it("rewrites integer + number to anyOf", () => {
    const spec = specWith({
      oneOf: [{ type: "integer" }, { type: "string" }, { type: "number" }],
    });
    const out = relaxOverlappingOneOf(spec);
    expect(out.components.schemas.Target.oneOf).toBeUndefined();
    expect(out.components.schemas.Target.anyOf).toHaveLength(3);
  });

  it("rewrites 2+ object branches with no additionalProperties:false to anyOf", () => {
    const spec = specWith({
      oneOf: [{ $ref: "#/components/schemas/ObjA" }, { $ref: "#/components/schemas/ObjB" }],
    });
    const out = relaxOverlappingOneOf(spec);
    expect(out.components.schemas.Target.oneOf).toBeUndefined();
    expect(out.components.schemas.Target.anyOf).toEqual([
      { $ref: "#/components/schemas/ObjA" },
      { $ref: "#/components/schemas/ObjB" },
    ]);
  });

  it("leaves oneOf alone when a branch is closed with additionalProperties:false", () => {
    const spec = specWith({
      oneOf: [{ $ref: "#/components/schemas/ObjA" }, { $ref: "#/components/schemas/ObjClosed" }],
    });
    const out = relaxOverlappingOneOf(spec);
    expect(out.components.schemas.Target.anyOf).toBeUndefined();
    expect(out.components.schemas.Target.oneOf).toHaveLength(2);
  });

  it("leaves a nullable union (e.g. [integer, null]) alone", () => {
    const spec = specWith({ oneOf: [{ type: "integer" }, { type: "null" }] });
    const out = relaxOverlappingOneOf(spec);
    expect(out.components.schemas.Target.anyOf).toBeUndefined();
    expect(out.components.schemas.Target.oneOf).toEqual([{ type: "integer" }, { type: "null" }]);
  });

  it("does not mutate the input spec", () => {
    const spec = specWith({ oneOf: [{ type: "integer" }, { type: "number" }] });
    relaxOverlappingOneOf(spec);
    expect(spec.components.schemas.Target.oneOf).toEqual([{ type: "integer" }, { type: "number" }]);
    expect(spec.components.schemas.Target.anyOf).toBeUndefined();
  });
});
