// @license MIT
import { describe, it, expect } from "vitest";
import {
  analyzePlayer,
  comparePlayers,
  factionMemberActivity,
  findProfitableItems,
  warReadinessReport,
  type TornCall,
} from "./services.js";

/** Build a mock call that returns canned responses keyed by `tag/endpoint`. */
function mockCall(responses: Record<string, any>): TornCall {
  return async (tag, endpoint) => {
    const key = `${tag}/${endpoint}`;
    if (!(key in responses)) throw new Error(`no mock for ${key}`);
    return responses[key];
  };
}

describe("analyzePlayer", () => {
  it("derives status, activity, and life pct", async () => {
    const call = mockCall({
      "user/profile": {
        profile: {
          id: 1,
          name: "Bob",
          level: 50,
          age: 100,
          status: { state: "Okay" },
          last_action: { status: "Online", relative: "1 minute ago" },
          life: { current: 50, maximum: 100 },
          faction_id: 7,
        },
      },
      "user/personalstats": { personalstats: { foo: 1 } },
    });
    const r = await analyzePlayer(call, "1");
    expect(r.name).toBe("Bob");
    expect(r.status).toBe("Okay");
    expect(r.online).toBe("Online");
    expect(r.life?.pct).toBe(50);
    expect(r.personalstats).toEqual({ foo: 1 });
  });

  it("tolerates a failing personalstats call", async () => {
    const call: TornCall = async (tag, endpoint) => {
      if (endpoint === "personalstats") throw new Error("no access");
      return { profile: { id: 1, name: "Bob" } };
    };
    const r = await analyzePlayer(call, "1");
    expect(r.name).toBe("Bob");
    expect(r.personalstats).toBeNull();
  });
});

describe("comparePlayers", () => {
  it("computes level gap to the strongest", async () => {
    const call: TornCall = async (_t, _e, id) => ({
      profile: { id: Number(id), name: `P${id}`, level: id === "1" ? 30 : 80 },
    });
    const r = await comparePlayers(call, ["1", "2"]);
    expect(r.count).toBe(2);
    const p1 = r.players.find((p) => p.id === 1);
    expect(p1?.level_gap_to_top).toBe(50);
  });
});

describe("factionMemberActivity", () => {
  it("buckets members by last-action status", async () => {
    const call = mockCall({
      "faction/members": {
        members: [
          { id: 1, name: "A", last_action: { status: "Online" } },
          { id: 2, name: "B", last_action: { status: "Idle" } },
          { id: 3, name: "C", last_action: { status: "Offline" } },
          { id: 4, name: "D", last_action: { status: "Online" } },
        ],
      },
    });
    const r = await factionMemberActivity(call);
    expect(r.counts).toEqual({ online: 2, idle: 1, offline: 1 });
  });
});

describe("warReadinessReport", () => {
  it("scores readiness from availability", async () => {
    const call = mockCall({
      "faction/members": {
        members: [
          { id: 1, status: { state: "Okay" }, last_action: { status: "Online" }, is_on_wall: true },
          { id: 2, status: { state: "Hospital" }, last_action: { status: "Offline" } },
        ],
      },
    });
    const r = await warReadinessReport(call);
    expect(r.total).toBe(2);
    expect(r.breakdown.okay).toBe(1);
    expect(r.breakdown.hospital).toBe(1);
    expect(r.breakdown.on_wall).toBe(1);
    expect(r.readiness_pct).toBe(50);
  });
});

describe("findProfitableItems", () => {
  it("ranks by margin (reference value minus lowest listing)", async () => {
    const call: TornCall = async (tag, _e, id) => {
      if (tag === "market") {
        const lowest = id === "1" ? 100 : 900;
        return { itemmarket: { item: { id: Number(id), name: `I${id}` }, listings: [{ price: lowest, amount: 1 }] } };
      }
      return { items: [{ id: Number(id), value: { market_price: 1000 } }] };
    };
    const r = await findProfitableItems(call, ["1", "2"]);
    // item 1: margin 900; item 2: margin 100 → item 1 first
    expect(r.items[0]?.id).toBe(1);
    expect(r.items[0]?.margin).toBe(900);
  });
});
