// @license MIT
// Safety net behind relax-oneof.mjs. Most Torn overlap is dodged at the
// schema level (oneOf → anyOf) before ajv ever runs; this catches whatever
// still reaches ajv as a oneOf failure with more than one matching branch.
// With `allErrors: true`, ajv staples the LOSING branches' own errors onto
// that failure too — orphaned "wrong type" / "not one of the allowed values"
// complaints that look like drift but are really just the branches the value
// didn't happen to match. A oneOf/anyOf failure with ZERO matching branches
// has no losing-branch ambiguity to drop — those child errors are real drift
// and stay.

const isUnionKeyword = (keyword) => keyword === "oneOf" || keyword === "anyOf";

/** An ajv oneOf error whose branches matched more than once (spec overlap, not drift). */
const isOverlapParent = (e) =>
  e.keyword === "oneOf" && Array.isArray(e.params?.passingSchemas) && e.params.passingSchemas.length > 1;

/**
 * Classify ajv's `errors` for one endpoint. Drops errors orphaned by an
 * overlapping oneOf; if nothing but oneOf/anyOf errors survive → "smell"
 * (known spec overlap); if nothing survives → "pass"; otherwise → "fail"
 * with the real errors.
 */
export function classifyErrors(errs) {
  if (!errs || errs.length === 0) return { status: "pass", relevant: [] };

  const overlapParents = errs.filter(isOverlapParent);
  const dropped = new Set();
  for (const parent of overlapParents) {
    for (const e of errs) {
      if (e === parent || dropped.has(e)) continue;
      if (e.instancePath.startsWith(parent.instancePath)) dropped.add(e);
    }
  }

  const survivors = errs.filter((e) => !dropped.has(e));
  if (survivors.length === 0) return { status: "pass", relevant: [] };

  const onlyUnion = survivors.every((e) => isUnionKeyword(e.keyword));
  const status = onlyUnion ? "smell" : "fail";
  const relevant = status === "fail" ? survivors.filter((e) => !isUnionKeyword(e.keyword)) : survivors;
  return { status, relevant };
}
