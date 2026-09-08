// @license MIT
// Regression tests for the two live-fixture false positives this module
// exists to fix: torn/hof's `value` (oneOf [integer, string, number]) and
// user/missions' `rewards[].details` (oneOf [Ammo, Upgrade, Item]). Loads the
// real openapi.json and validates with the exact ajv setup conformance.mjs
// uses, so a regression in either the spec or the relax/filter pair shows up
// here without a live Torn call.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { relaxOverlappingOneOf } from "./relax-oneof.mjs";
import { classifyErrors } from "./conformance-filter.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let validatorFor;

beforeAll(() => {
  const spec = JSON.parse(readFileSync(join(root, "openapi.json"), "utf8"));
  const relaxed = relaxOverlappingOneOf(spec);
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, verbose: true });
  addFormats(ajv);
  ajv.addSchema(relaxed, "spec");
  validatorFor = (name) => {
    const ref = `spec#/components/schemas/${name}`;
    return ajv.getSchema(ref) ?? ajv.compile({ $ref: ref });
  };
});

function classify(schemaName, payload) {
  const validate = validatorFor(schemaName);
  const ok = validate(payload);
  return ok ? { status: "pass", relevant: [] } : classifyErrors(validate.errors ?? []);
}

function hofResponse(value) {
  return {
    hof: [
      {
        id: 1,
        username: "duke",
        faction_id: 1,
        level: 10,
        last_action: 0,
        rank_name: "Novice",
        rank_number: 1,
        position: 1,
        signed_up: 0,
        age_in_days: 1,
        value,
        rank: "gold",
      },
    ],
    _metadata: { links: { next: null, prev: null } },
  };
}

function missionsResponse(reward) {
  return {
    missions: {
      credits: 0,
      givers: [],
      rewards: [reward],
    },
  };
}

describe("torn/hof fixture — TornHofBasic.value oneOf[integer, string, number]", () => {
  it.each([
    ["integer", 12345],
    ["float", 12.5],
    ["string", "Absolute beginner"],
  ])("passes for a valid %s value", (_label, value) => {
    expect(classify("TornHofResponse", hofResponse(value)).status).toBe("pass");
  });

  it("fails for a boolean value (matches no branch)", () => {
    expect(classify("TornHofResponse", hofResponse(true)).status).toBe("fail");
  });

  it("fails for a null value (matches no branch)", () => {
    expect(classify("TornHofResponse", hofResponse(null)).status).toBe("fail");
  });

  it("still fails on a genuinely missing required field (regression guard)", () => {
    const payload = hofResponse(12345);
    delete payload.hof[0].username;
    const result = classify("TornHofResponse", payload);
    expect(result.status).toBe("fail");
    expect(result.relevant.some((e) => e.keyword === "required")).toBe(true);
  });
});

describe("user/missions fixture — rewards[].details oneOf[Ammo, Upgrade, Item]", () => {
  it("passes an Item reward matching the Item branch", () => {
    const reward = {
      type: "Item",
      details: { id: 1, name: "Baseball Bat", type: "Weapon", sub_type: "Clubbing" },
      amount: 1,
      cost: 10,
      expires_at: 1,
    };
    expect(classify("UserMissionsResponse", missionsResponse(reward)).status).toBe("pass");
  });

  it("passes a reward with an undocumented type string and a null sub_type", () => {
    const reward = {
      type: "Medical",
      details: { id: 1, name: "Baseball Bat", type: "Weapon", sub_type: null },
      amount: 1,
      cost: 10,
      expires_at: 1,
    };
    expect(classify("UserMissionsResponse", missionsResponse(reward)).status).toBe("pass");
  });

  it("passes an Ammo reward matching the Ammo branch", () => {
    const reward = {
      type: "Ammo",
      details: { id: 1, name: "9mm", type: "Standard" },
      amount: 1,
      cost: 10,
      expires_at: 1,
    };
    expect(classify("UserMissionsResponse", missionsResponse(reward)).status).toBe("pass");
  });

  it("passes an Upgrade reward matching the Upgrade branch", () => {
    const reward = {
      type: "Upgrade",
      details: { id: 1, name: "Scope" },
      amount: 1,
      cost: 10,
      expires_at: 1,
    };
    expect(classify("UserMissionsResponse", missionsResponse(reward)).status).toBe("pass");
  });

  it("documented limitation: an Item reward with an invalid details.type still passes, because it also matches the open Upgrade branch (no additionalProperties:false to reject the stray 'type' field)", () => {
    const reward = {
      type: "Item",
      details: { id: 1, name: "Baseball Bat", type: "NotAType", sub_type: "Clubbing" },
      amount: 1,
      cost: 10,
      expires_at: 1,
    };
    expect(classify("UserMissionsResponse", missionsResponse(reward)).status).toBe("pass");
  });

  it("still fails on a genuinely missing required field (regression guard)", () => {
    const reward = {
      type: "Ammo",
      details: { id: 1, name: "9mm", type: "Standard" },
      amount: 1,
      cost: 10,
      // expires_at omitted
    };
    const result = classify("UserMissionsResponse", missionsResponse(reward));
    expect(result.status).toBe("fail");
    expect(result.relevant.some((e) => e.keyword === "required")).toBe(true);
  });
});
