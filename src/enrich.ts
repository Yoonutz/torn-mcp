// @license MIT
// Pure data-correctness helpers ported from the sibling "Sol" project. No Worker
// globals here so these stay unit-testable in plain Node (vitest). Torn payloads
// are dynamically shaped, so we read them as `any` and access defensively.
import { humanizeTimestamps } from "./torn.js";

type Json = any;

/** Default ceilings (named so callers and tests share one source of truth). */
export const MAX_PAGES = 3;
export const MAX_ITEMS = 50;
export const MAX_BYTES = 24_000;

/**
 * Torn wraps payloads under one data key plus `_metadata` (e.g. `{ attacks: [...],
 * _metadata }`). Return that data key and its value, ignoring `_`-prefixed keys.
 */
function unwrapData(page: Json): { dataKey: string | null; value: Json } {
  if (!page || typeof page !== "object" || Array.isArray(page)) {
    return { dataKey: null, value: undefined };
  }
  for (const key of Object.keys(page)) {
    if (key.startsWith("_")) continue;
    return { dataKey: key, value: (page as Record<string, Json>)[key] };
  }
  return { dataKey: null, value: undefined };
}

/**
 * Merge paginated payloads: concat array fields, shallow-merge object maps. Keeps
 * the LAST page's `_metadata` (reflects where the walk stopped) and records the
 * page count. Ports Sol `_mergePages`.
 */
export function mergePages(pages: Json[]): Json {
  const out: Record<string, Json> = {};
  for (const page of pages) {
    if (!page || typeof page !== "object") continue;
    for (const key of Object.keys(page)) {
      if (key === "_metadata") continue;
      const value = (page as Record<string, Json>)[key];
      if (Array.isArray(value)) {
        out[key] = (Array.isArray(out[key]) ? (out[key] as Json[]) : []).concat(value);
      } else if (value && typeof value === "object") {
        out[key] = Object.assign(out[key] ?? {}, value);
      } else if (!(key in out)) {
        out[key] = value;
      }
    }
  }
  const last = pages.length ? pages[pages.length - 1] : undefined;
  out._metadata = last && typeof last === "object" ? (last as Record<string, Json>)._metadata : undefined;
  out._pages_fetched = pages.length;
  return out;
}

/** True when the unwrapped payload holds no list items / no map entries. */
export function isEmptyPayload(data: Json): boolean {
  const { dataKey, value } = unwrapData(data);
  if (dataKey === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === "object") return Object.keys(value).length === 0;
  return value === undefined || value === null;
}

const UNIT_SECONDS: Record<string, number> = {
  m: 60, min: 60, h: 3600, hr: 3600, d: 86400, day: 86400, w: 604800, week: 604800,
};

function startOfUtcDay(nowSec: number): number {
  const d = new Date(nowSec * 1000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
}

/** Resolve one from/to value to integer Unix seconds, or null if unrecognized. */
function resolveToken(raw: string | number, nowSec: number): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  const text = String(raw).trim().toLowerCase();
  if (/^\d+$/.test(text)) return parseInt(text, 10);

  const rel = text.match(/^-(\d+)\s*(m|min|h|hr|d|day|w|week)$/);
  if (rel) {
    const count = parseInt(rel[1]!, 10);
    const unit = UNIT_SECONDS[rel[2]!];
    if (unit) return nowSec - count * unit;
  }

  const startOfToday = startOfUtcDay(nowSec);
  if (text === "today") return startOfToday;
  if (text === "yesterday") return startOfToday - 86400;

  return null;
}

/**
 * Resolve relative-time tokens in `from`/`to` to integer Unix seconds. Integers
 * pass through (floored); unknown tokens are left untouched so validateParams /
 * Torn can reject them. `now` is milliseconds (e.g. Date.now()). Returns a new
 * object — the input is not mutated. Ports Sol `_parseRelativeTime_`.
 */
export function resolveTimeParams(
  params: Record<string, string | number> | undefined,
  now: number,
): Record<string, string | number> {
  const out: Record<string, string | number> = { ...(params ?? {}) };
  const nowSec = Math.floor(now / 1000);
  for (const field of ["from", "to"] as const) {
    if (out[field] === undefined) continue;
    const resolved = resolveToken(out[field], nowSec);
    if (resolved !== null) out[field] = resolved;
  }
  return out;
}

/** Fetch one absolute Torn URL and return its parsed JSON, or throw. */
export type PageFetcher = (url: string) => Promise<Json>;

/**
 * Given an already-fetched first page, follow `_metadata.links` (next, else prev —
 * Torn lists are newest-first so continuation is usually prev) up to `max` total
 * pages and merge. A throw from `fetchUrl` (rate-limit / transient error) stops
 * the walk and flags the result partial. Ports Sol `_followPages_`.
 */
export async function followPages(
  firstPage: Json,
  fetchUrl: PageFetcher,
  max: number,
): Promise<{ merged: Json; partial: boolean }> {
  const pages: Json[] = [firstPage];
  let partial = false;
  const firstLinks = firstPage?._metadata?.links ?? {};
  const direction: "next" | "prev" | null =
    firstLinks.next ? "next" : firstLinks.prev ? "prev" : null;

  let current = firstPage;
  while (direction && pages.length < max) {
    const url = current?._metadata?.links?.[direction];
    if (!url) break;
    try {
      current = await fetchUrl(url);
    } catch {
      partial = true;
      break;
    }
    pages.push(current);
  }
  return { merged: mergePages(pages), partial };
}

const TIME_FIELDS = ["timestamp", "time", "started", "ended", "created", "executed", "date"];
const TIME_KEY_RE = /(time|stamp|started|ended|executed|created|date)/i;
const EPOCH_MIN = 1_000_000_000;
const EPOCH_MAX = 4_000_000_000;
export const WINDOW_NOTE = "No results in the requested time window; showing the most recent instead.";

/** Pick a list item's Unix-epoch timestamp, or null if undeterminable. */
function timeOf(item: Json): number | null {
  if (!item || typeof item !== "object") return null;
  for (const field of TIME_FIELDS) {
    if (typeof item[field] === "number") return item[field];
  }
  for (const key of Object.keys(item)) {
    const value = item[key];
    if (typeof value === "number" && value >= EPOCH_MIN && value <= EPOCH_MAX && TIME_KEY_RE.test(key)) {
      return value;
    }
  }
  return null;
}

function toEpoch(x: number | string | undefined): number | undefined {
  if (x === undefined || x === null || x === "") return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Filter the payload's list to a from/to Unix window. Torn ignores from/to on
 * some endpoints, so we enforce it client-side. Items with no detectable time
 * field are kept (fail-open). Three outcomes (Sol's): items in window → filtered;
 * items but none in window → restore unfiltered + note; empty list → note only.
 * Returns a new object (input not mutated). Ports Sol `_filterByTimeWindow_`.
 */
export function filterByTimeWindow(
  data: Json,
  window: { from?: number | string; to?: number | string },
): Json {
  const from = toEpoch(window.from);
  const to = toEpoch(window.to);
  if (from === undefined && to === undefined) return data;

  const { dataKey, value } = unwrapData(data);
  if (dataKey === null || !Array.isArray(value)) return data;

  const items = value as Json[];
  if (items.length === 0) return { ...data, _note: WINDOW_NOTE };

  const kept = items.filter((item) => {
    const ts = timeOf(item);
    if (ts === null) return true;
    if (from !== undefined && ts < from) return false;
    if (to !== undefined && ts > to) return false;
    return true;
  });

  if (kept.length === 0) return { ...data, [dataKey]: items, _note: WINDOW_NOTE };
  return { ...data, [dataKey]: kept };
}

/**
 * Drop the largest non-`_` fields until the receipt-included payload is under the
 * byte cap (oversized non-list payloads). The `_truncated` receipt's own bytes
 * are counted while measuring, mirroring the array path. If the irreducible
 * residual (`_`-prefixed fields + braces) alone still exceeds maxBytes, this is
 * best-effort: it returns the smallest payload it can reach.
 */
function dropLargestFields(data: Json, maxBytes: number): Json {
  const working: Record<string, Json> = { ...data };
  const dropped: string[] = [];
  const build = (): Json =>
    dropped.length ? { ...working, _truncated: { fields_dropped: dropped } } : { ...working };

  const fields = Object.keys(working)
    .filter((k) => !k.startsWith("_"))
    .map((k) => ({ k, size: JSON.stringify(working[k]).length }))
    .sort((a, b) => b.size - a.size);

  for (const { k } of fields) {
    if (JSON.stringify(build()).length <= maxBytes) break;
    delete working[k];
    dropped.push(k);
  }
  return build();
}

/**
 * Cap the merged list to `maxItems`, then pop trailing items until the whole
 * payload is under `maxBytes`. Records what was cut in a sibling `_truncated`
 * field. Top-level only — simpler than Sol's recursive `_truncateObj`, and we
 * never inject a sentinel string into the array. Returns a new object.
 */
export function truncate(data: Json, opts: { maxItems: number; maxBytes: number }): Json {
  if (!data || typeof data !== "object") return data;
  const { dataKey, value } = unwrapData(data);

  if (dataKey === null || !Array.isArray(value)) {
    if (JSON.stringify(data).length <= opts.maxBytes) return data;
    return dropLargestFields(data, opts.maxBytes);
  }

  let items = (value as Json[]).slice();
  let omitted = 0;
  if (items.length > opts.maxItems) {
    omitted = items.length - opts.maxItems;
    items = items.slice(0, opts.maxItems);
  }

  // Build the candidate including the `_truncated` receipt so its bytes count
  // against the cap (otherwise the receipt could push the result back over).
  const build = (): Record<string, Json> => {
    const o: Record<string, Json> = { ...data, [dataKey]: items };
    if (omitted > 0) o._truncated = { items_omitted: omitted };
    return o;
  };

  let out = build();
  while (items.length > 0 && JSON.stringify(out).length > opts.maxBytes) {
    items = items.slice(0, -1);
    omitted += 1;
    out = build();
  }

  return out;
}

/** Mutates the (already humanized) payload to add computed sibling fields. */
type Annotator = (data: Json) => void;

const num = (x: Json): number => (typeof x === "number" ? x : 0);

/**
 * Computed-annotation registry keyed by `${tag}/${endpoint}`. Add a new entry to
 * extend — each annotator reads defensively and mutates the payload in place.
 */
const COMPUTED: Record<string, Annotator> = {
  "user/money": (data) => {
    const money = data?.money;
    if (!money || typeof money !== "object") return;
    const total =
      num(money.wallet) + num(money.vault) + num(money.company) + num(money.cayman_bank) +
      (money.city_bank ? num(money.city_bank.amount) : 0) +
      (money.faction ? num(money.faction.money) : 0);
    money._computed = {
      total_cash: total,
      breakdown: "wallet + vault + company + cayman_bank + city_bank.amount + faction.money",
      excluded: "points (separate currency), daily_networth (valuation, not cash)",
    };
  },
};

/**
 * Humanize epoch timestamps (reusing torn.ts) then apply any computed annotation
 * registered for this endpoint. Returns the enriched copy. Ports Sol
 * `_annotateTimestamps_` + `_annotateComputed_`.
 */
export function annotate(tag: string, endpoint: string, data: Json): Json {
  const humanized = humanizeTimestamps(data) as Json;
  const annotator = COMPUTED[`${tag}/${endpoint}`];
  if (annotator) annotator(humanized);
  return humanized;
}
