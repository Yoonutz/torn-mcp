// @license MIT
// Per-API-key rate limiter as a Durable Object. One instance per hashed key,
// so the counter is shared across all isolates/sessions for that key — which an
// in-memory token bucket in the Worker could never guarantee.

/** Torn allows ~100 requests per minute per key. */
export const LIMIT = 100;
export const WINDOW_MS = 60_000;

export interface RateCheck {
  limited: boolean;
  remaining: number;
  resetMs: number;
}

export class RateLimiter implements DurableObject {
  private count = 0;
  private windowStart = 0;

  // State is held in memory; if the DO is evicted the window simply resets,
  // which fails open (safe for a courtesy limiter, never under-counts a live burst).
  constructor(_state: DurableObjectState) {}

  async fetch(_request: Request): Promise<Response> {
    const now = Date.now();
    if (now - this.windowStart >= WINDOW_MS) {
      this.windowStart = now;
      this.count = 0;
    }
    this.count += 1;
    const limited = this.count > LIMIT;
    const body: RateCheck = {
      limited,
      remaining: Math.max(0, LIMIT - this.count),
      resetMs: this.windowStart + WINDOW_MS - now,
    };
    return Response.json(body);
  }
}
