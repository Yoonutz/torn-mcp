// @license MIT
export const DEFAULT_RATE_LIMIT_BATCH = 90;
export const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;
export const DEFAULT_MIN_CALL_SPACING_MS = 650;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parsePositiveInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createConformanceThrottle({
  batchSize = DEFAULT_RATE_LIMIT_BATCH,
  pauseMs = DEFAULT_RATE_LIMIT_PAUSE_MS,
  minCallSpacingMs = DEFAULT_MIN_CALL_SPACING_MS,
  sleep = defaultSleep,
  now = Date.now,
  onBatchPause,
  onRetry,
} = {}) {
  let requestsInBatch = 0;
  let lastCallAt = 0;

  async function gate() {
    if (requestsInBatch >= batchSize) {
      if (onBatchPause) onBatchPause({ requestsInBatch, batchSize, pauseMs });
      await sleep(pauseMs);
      requestsInBatch = 0;
      lastCallAt = 0;
    }
    const wait = minCallSpacingMs - (now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = now();
  }

  async function run(doRequest) {
    await gate();
    let out = await doRequest();
    requestsInBatch += 1;

    if (out?.json?.error?.code === 5) {
      if (onRetry) onRetry({ pauseMs });
      await sleep(pauseMs);
      requestsInBatch = 0;
      lastCallAt = 0;
      await gate();
      out = await doRequest();
      requestsInBatch += 1;
    }

    return out;
  }

  return { run };
}
