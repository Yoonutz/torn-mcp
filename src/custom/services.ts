// @license MIT
// Intelligence-layer aggregation services. Each calls one or more Torn
// endpoints and returns a structured, AI-friendly summary instead of raw JSON.
//
// `call()` results are cast to their generated response type (src/generated/
// types.ts), so a Torn field rename fails typecheck here instead of silently
// degrading a summary. Reads stay defensive (optional chaining) because Torn
// fields are frequently nullable. Helpers take `any` — the type safety that
// matters is on the response-field access in each service body.
import type { components } from "../generated/types.js";

type S = components["schemas"];

/** Resolve tag+endpoint(+id) and return the parsed Torn JSON, or throw. */
export type TornCall = (
  tag: string,
  endpoint: string,
  id?: string,
  params?: Record<string, string | number>,
) => Promise<any>;

function lifePct(life: any): number | undefined {
  const cur = life?.current;
  const max = life?.maximum;
  return typeof cur === "number" && typeof max === "number" && max > 0
    ? Math.round((100 * cur) / max)
    : undefined;
}

function activityBucket(lastActionStatus: unknown): "online" | "idle" | "offline" {
  const s = String(lastActionStatus ?? "").toLowerCase();
  if (s === "online") return "online";
  if (s === "idle") return "idle";
  return "offline";
}

function lowestPrice(listings: any[]): number | undefined {
  const prices = listings
    .map((l) => l?.price)
    .filter((n): n is number => typeof n === "number");
  return prices.length ? Math.min(...prices) : undefined;
}

function depth(listings: any[]): number {
  return listings.reduce((a, l) => a + (typeof l?.amount === "number" ? l.amount : 0), 0);
}

// ── Player ──────────────────────────────────────────────────────────

export async function analyzePlayer(call: TornCall, id?: string) {
  const [profileRes, statsRes] = await Promise.all([
    call("user", "profile", id) as Promise<S["UserProfileResponse"]>,
    call("user", "personalstats", id).catch(() => null) as Promise<S["UserPersonalStatsResponse"] | null>,
  ]);
  const p = profileRes?.profile;
  return {
    id: p?.id,
    name: p?.name,
    level: p?.level,
    status: p?.status?.state ?? p?.status?.description,
    online: p?.last_action?.status,
    last_action: p?.last_action?.relative,
    life: lifePct(p?.life) !== undefined
      ? { current: p?.life?.current, maximum: p?.life?.maximum, pct: lifePct(p?.life) }
      : undefined,
    age_days: p?.age,
    faction_id: p?.faction_id ?? null,
    social: {
      awards: p?.awards,
      friends: p?.friends,
      enemies: p?.enemies,
      karma: p?.karma,
    },
    personalstats: statsRes?.personalstats ?? null,
  };
}

export async function summarizePlayer(call: TornCall, id?: string) {
  const res = (await call("user", "profile", id)) as S["UserProfileResponse"];
  const p = res?.profile;
  return {
    id: p?.id,
    name: p?.name,
    level: p?.level,
    status: p?.status?.state ?? p?.status?.description,
    online: p?.last_action?.status,
    last_action: p?.last_action?.relative,
    life_pct: lifePct(p?.life),
    faction_id: p?.faction_id ?? null,
  };
}

export async function comparePlayers(call: TornCall, ids: string[]) {
  const players = await Promise.all(
    ids.map(async (id) => {
      const res = (await call("user", "profile", id)) as S["UserProfileResponse"];
      const p = res?.profile;
      return {
        id: p?.id ?? id,
        name: p?.name,
        level: p?.level,
        status: p?.status?.state ?? p?.status?.description,
        online: p?.last_action?.status,
        life_pct: lifePct(p?.life),
      };
    }),
  );
  const topLevel = Math.max(0, ...players.map((p) => Number(p.level ?? 0)));
  return {
    count: players.length,
    players: players.map((p) => ({
      ...p,
      level_gap_to_top: topLevel - Number(p.level ?? 0),
    })),
  };
}

// ── Faction ─────────────────────────────────────────────────────────

function memberActivity(members: any[]) {
  const counts = { online: 0, idle: 0, offline: 0 };
  for (const m of members) counts[activityBucket(m?.last_action?.status)]++;
  return counts;
}

export async function summarizeFaction(call: TornCall, id?: string) {
  const [basicRes, membersRes] = await Promise.all([
    call("faction", "basic", id) as Promise<S["FactionBasicResponse"]>,
    call("faction", "members", id).catch(() => null) as Promise<S["FactionMembersResponse"] | null>,
  ]);
  const members = membersRes?.members ?? [];
  const byPosition: Record<string, number> = {};
  for (const m of members) {
    const pos = m?.position ?? "Unknown";
    byPosition[pos] = (byPosition[pos] ?? 0) + 1;
  }
  return {
    faction: basicRes?.basic ?? null,
    member_count: members.length,
    members_by_position: byPosition,
    members_by_activity: memberActivity(members),
  };
}

export async function factionMemberActivity(call: TornCall, id?: string) {
  const res = (await call("faction", "members", id)) as S["FactionMembersResponse"];
  const members = res?.members ?? [];
  type Entry = { id: unknown; name: unknown; last_action: unknown };
  const buckets: Record<"online" | "idle" | "offline", Entry[]> = {
    online: [],
    idle: [],
    offline: [],
  };
  for (const m of members) {
    buckets[activityBucket(m?.last_action?.status)].push({
      id: m?.id,
      name: m?.name,
      last_action: m?.last_action?.relative,
    });
  }
  return {
    total: members.length,
    counts: {
      online: buckets.online.length,
      idle: buckets.idle.length,
      offline: buckets.offline.length,
    },
    members: buckets,
  };
}

export async function warReadinessReport(call: TornCall, id?: string) {
  const res = (await call("faction", "members", id)) as S["FactionMembersResponse"];
  const members = res?.members ?? [];
  const breakdown = {
    okay: 0,
    hospital: 0,
    traveling: 0,
    other: 0,
    online: 0,
    in_oc: 0,
    on_wall: 0,
  };
  const detail = members.map((m) => {
    const state = String(m?.status?.state ?? m?.status?.description ?? "Unknown");
    if (/okay/i.test(state)) breakdown.okay++;
    else if (/hosp/i.test(state)) breakdown.hospital++;
    else if (/trav/i.test(state)) breakdown.traveling++;
    else breakdown.other++;
    if (activityBucket(m?.last_action?.status) === "online") breakdown.online++;
    if (m?.is_in_oc) breakdown.in_oc++;
    if (m?.is_on_wall) breakdown.on_wall++;
    return {
      id: m?.id,
      name: m?.name,
      state,
      online: m?.last_action?.status,
      is_on_wall: m?.is_on_wall,
      is_in_oc: m?.is_in_oc,
    };
  });
  const total = members.length;
  return {
    total,
    // Availability-based: per-member battlestats are not exposed by the API.
    readiness_pct: total ? Math.round((100 * breakdown.okay) / total) : 0,
    breakdown,
    members: detail,
  };
}

export async function territorySummary(call: TornCall, id?: string) {
  const [factionRes, globalRes] = await Promise.all([
    call("faction", "territory", id).catch(() => null) as Promise<S["FactionTerritoriesResponse"] | null>,
    call("torn", "territory").catch(() => null) as Promise<S["TornTerritoriesResponse"] | null>,
  ]);
  const factionTerr = factionRes?.territory;
  const globalTerr = globalRes?.territory;
  return {
    faction_territory_count: Array.isArray(factionTerr) ? factionTerr.length : undefined,
    faction_territory: factionTerr ?? null,
    global_territory_sample: Array.isArray(globalTerr) ? globalTerr.slice(0, 10) : globalTerr ?? null,
  };
}

export async function crimeAnalysis(call: TornCall, id?: string) {
  const res = (await call("faction", "crimes", id)) as S["FactionCrimesResponse"];
  const crimes = res?.crimes ?? [];
  const byStatus: Record<string, number> = {};
  const byDifficulty: Record<string, number> = {};
  let success = 0;
  let failed = 0;
  for (const c of crimes) {
    const status = String(c?.status ?? "Unknown");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const diff = String(c?.difficulty ?? "?");
    byDifficulty[diff] = (byDifficulty[diff] ?? 0) + 1;
    if (/success/i.test(status)) success++;
    if (/fail/i.test(status)) failed++;
  }
  const completed = success + failed;
  return {
    total: crimes.length,
    by_status: byStatus,
    by_difficulty: byDifficulty,
    success,
    failed,
    success_rate: completed ? Math.round((100 * success) / completed) : undefined,
  };
}

// ── Company ─────────────────────────────────────────────────────────

export async function summarizeCompany(call: TornCall, id?: string) {
  const [profileRes, employeesRes] = await Promise.all([
    call("company", "profile", id) as Promise<S["CompanyProfileResponseMixed"]>,
    call("company", "employees", id).catch(() => null) as Promise<S["CompanyEmployeesResponse"] | null>,
  ]);
  const employees = employeesRes?.employees ?? [];
  return {
    company: (profileRes as any)?.profile ?? null,
    employee_count: employees.length,
  };
}

// ── Market ──────────────────────────────────────────────────────────

export async function itemMarketAnalysis(call: TornCall, id: string) {
  const [marketRes, tornRes] = await Promise.all([
    call("market", "itemmarket", id) as Promise<S["MarketItemMarketResponse"]>,
    call("torn", "items", id).catch(() => null) as Promise<S["TornItemsResponse"] | null>,
  ]);
  const im = marketRes?.itemmarket;
  const listings = im?.listings ?? [];
  const prices = listings
    .map((l) => l?.price)
    .filter((n): n is number => typeof n === "number");
  const tItem = (tornRes?.items ?? [])[0];
  return {
    id: im?.item?.id ?? id,
    name: im?.item?.name,
    type: im?.item?.type,
    average_price: im?.item?.average_price,
    market_value: tItem?.value?.market_price,
    listings: {
      count: listings.length,
      lowest: prices.length ? Math.min(...prices) : undefined,
      highest: prices.length ? Math.max(...prices) : undefined,
      depth: depth(listings),
    },
  };
}

export async function marketAnalysis(call: TornCall, itemIds: string[]) {
  const items = await Promise.all(
    itemIds.map(async (id) => {
      const res = (await call("market", "itemmarket", id)) as S["MarketItemMarketResponse"];
      const im = res?.itemmarket;
      const listings = im?.listings ?? [];
      const lowest = lowestPrice(listings);
      const avg = im?.item?.average_price;
      return {
        id: im?.item?.id ?? id,
        name: im?.item?.name,
        average_price: avg,
        lowest_listing: lowest,
        listings: listings.length,
        depth: depth(listings),
        spread:
          typeof avg === "number" && typeof lowest === "number" ? avg - lowest : undefined,
      };
    }),
  );
  items.sort((a, b) => (b.spread ?? -Infinity) - (a.spread ?? -Infinity));
  return { count: items.length, items };
}

export async function findProfitableItems(call: TornCall, itemIds: string[]) {
  const rows = await Promise.all(
    itemIds.map(async (id) => {
      const [marketRes, tornRes] = await Promise.all([
        call("market", "itemmarket", id) as Promise<S["MarketItemMarketResponse"]>,
        call("torn", "items", id).catch(() => null) as Promise<S["TornItemsResponse"] | null>,
      ]);
      const im = marketRes?.itemmarket;
      const listings = im?.listings ?? [];
      const lowest = lowestPrice(listings);
      const tItem = (tornRes?.items ?? [])[0];
      const reference = tItem?.value?.market_price ?? im?.item?.average_price;
      const margin =
        typeof reference === "number" && typeof lowest === "number"
          ? reference - lowest
          : undefined;
      return {
        id: im?.item?.id ?? id,
        name: im?.item?.name,
        lowest_listing: lowest,
        reference_value: reference,
        margin,
        margin_pct:
          typeof margin === "number" && typeof lowest === "number" && lowest > 0
            ? Math.round((100 * margin) / lowest)
            : undefined,
      };
    }),
  );
  rows.sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity));
  return { count: rows.length, items: rows };
}
