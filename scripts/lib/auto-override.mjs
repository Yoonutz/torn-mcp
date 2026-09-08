// @license MIT
// Decides whether a live response shape may replace the spec-derived `returns`
// in discovery. Schema-defined structure takes precedence over what one
// account happened to return, so an override is allowed only when:
//   - the live envelope has exactly the keys the spec documents, and
//   - the spec commits to one container type (object/array/scalar) for a key
//     and the live container type differs.
// A spec key typed oneOf/anyOf already admits several shapes and is never
// overridden; a live body with different keys is account-dependent and is
// reported as drift by the validator instead.

const normType = (t) => (t === "array" ? "array" : t === "object" ? "object" : "scalar");
const isUnion = (t) => t === "oneOf" || t === "anyOf";

/**
 * @param specReturns spec-derived [{ name, type, fields? }] (no overrides applied)
 * @param live        live-derived [{ name, type, fields? }]
 */
export function shouldAutoOverride(specReturns, live) {
  if (!Array.isArray(specReturns) || !Array.isArray(live) || !specReturns.length || !live.length) {
    return false;
  }
  const specKeys = specReturns.map((r) => r.name).sort();
  const liveKeys = live.map((r) => r.name).sort();
  if (JSON.stringify(specKeys) !== JSON.stringify(liveKeys)) return false;

  const liveType = Object.fromEntries(live.map((r) => [r.name, r.type]));
  return specReturns.some(
    (r) => !isUnion(r.type) && normType(r.type) !== normType(liveType[r.name]),
  );
}
