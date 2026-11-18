// @license MIT
// Pass/fail gate for the live conformance run. Pure, so every rule is unit
// tested (conformance-gate.test.ts). A run used to fail ONLY on new schema
// drift, so a broken test key (every call skipped) or a missing secret (silent
// compile-only mode) went green. These rules make "nothing was really tested"
// a failure too.

/** Unexpected skips (broken seed, new endpoint) tolerated before the run fails. */
export const DEFAULT_MAX_UNEXPECTED_SKIPS = 5;

/** A live run that skipped more than this share of endpoints tested nothing useful. */
export const MAX_SKIP_SHARE = 0.5;

/**
 * Check the first call of a live run (`/user/basic`). Returns why the test key
 * cannot be used, or null when it works.
 */
export function assessBootstrap(res) {
  if (res?.err) return `test key rejected on /user/basic: ${res.err}`;
  if (res?.json?.basic?.id == null) return "test key returned no user id on /user/basic";
  return null;
}

/**
 * Decide the exit code. Returns { exitCode, problems } where problems are
 * plain-English lines for the log and run summary.
 */
export function decideExit({
  compileOnly,
  keyPresent,
  requireKey,
  bootstrapError,
  newDrift,
  unexpectedSkips,
  tested,
  skipped,
  maxUnexpectedSkips = DEFAULT_MAX_UNEXPECTED_SKIPS,
}) {
  const problems = [];
  if (compileOnly) {
    if (requireKey && !keyPresent) {
      problems.push(
        "TORN_TEST_API_KEY is not set, so nothing was called. Add the secret, or run with --compile on purpose.",
      );
    }
    return { exitCode: problems.length ? 1 : 0, problems };
  }
  if (bootstrapError) problems.push(bootstrapError);
  if (newDrift > 0) problems.push(`${newDrift} endpoint(s) with new schema drift.`);
  const total = tested + skipped;
  if (total > 0 && skipped / total > MAX_SKIP_SHARE) {
    problems.push(`${skipped} of ${total} endpoints were skipped, so the run tested too little to trust.`);
  }
  if (unexpectedSkips > maxUnexpectedSkips) {
    problems.push(
      `${unexpectedSkips} unexpected skips (limit ${maxUnexpectedSkips}): a seed broke or new endpoints need one.`,
    );
  }
  return { exitCode: problems.length ? 1 : 0, problems };
}
