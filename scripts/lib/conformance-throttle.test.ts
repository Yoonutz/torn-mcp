// @license MIT
import { describe, it, expect, vi } from "vitest";
import { createConformanceThrottle } from "./conformance-throttle.mjs";

describe("createConformanceThrottle", () => {
  it("pauses before sending requests beyond a batch", async () => {
    const sleep = vi.fn(async () => {});
    const doRequest = vi.fn(async () => ({ json: {} }));
    const throttle = createConformanceThrottle({
      batchSize: 2,
      pauseMs: 60_000,
      minCallSpacingMs: 0,
      sleep,
    });

    await throttle.run(doRequest);
    await throttle.run(doRequest);
    await throttle.run(doRequest);

    expect(doRequest).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenNthCalledWith(1, 60_000);
  });

  it("waits and retries once on Torn error code 5", async () => {
    const sleep = vi.fn(async () => {});
    const doRequest = vi
      .fn()
      .mockResolvedValueOnce({ json: { error: { code: 5, error: "Too many requests" } }, ms: 10 })
      .mockResolvedValueOnce({ json: { ok: true }, ms: 20 });
    const throttle = createConformanceThrottle({
      batchSize: 90,
      pauseMs: 60_000,
      minCallSpacingMs: 0,
      sleep,
    });

    const out = await throttle.run(doRequest);
    expect(out).toEqual({ json: { ok: true }, ms: 60_030 });
    expect(doRequest).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenNthCalledWith(1, 60_000);
  });

  it("does not retry more than once when Torn still returns code 5", async () => {
    const sleep = vi.fn(async () => {});
    const doRequest = vi.fn(async () => ({ json: { error: { code: 5, error: "Too many requests" } } }));
    const throttle = createConformanceThrottle({
      batchSize: 90,
      pauseMs: 60_000,
      minCallSpacingMs: 0,
      sleep,
    });

    const out = await throttle.run(doRequest);
    expect(out).toEqual({ json: { error: { code: 5, error: "Too many requests" } } });
    expect(doRequest).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenNthCalledWith(1, 60_000);
  });
});
