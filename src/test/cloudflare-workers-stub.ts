// @license MIT
// Test-only stand-in for the `cloudflare:workers` module, which exists only
// inside workerd. Lets index.ts load in plain Node so its fetch code is testable.
export class DurableObject<Env = unknown> {
  constructor(
    protected ctx: unknown,
    protected env: Env,
  ) {}
}
