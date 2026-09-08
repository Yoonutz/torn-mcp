// @license MIT
// Torn's OpenAPI spec uses `oneOf` for unions whose branches can genuinely
// overlap on real data: `enum | string`, `integer | number`, and discriminated
// object unions where the "other" branches carry no `additionalProperties:
// false`. ajv's `oneOf` fails the instant more than one branch matches, and
// with `allErrors: true` it drags the losing branches' own errors along too —
// so a value that's simply valid comes out looking like "wrong type" or "not
// one of the allowed values" drift. Rewriting those `oneOf`s to `anyOf` before
// validation (this module) makes ajv accept the first matching branch and
// move on, same as it already accepts one clean match under `oneOf`.
//
// Validation-only: the returned spec is a clone, never the one used to build
// the catalog or the dev report.

function resolveBranch(branch, schemas, depth = 0) {
  if (branch && typeof branch === "object" && typeof branch.$ref === "string" && depth < 5) {
    const name = branch.$ref.split("/").pop();
    const target = schemas[name];
    if (target) return resolveBranch(target, schemas, depth + 1);
  }
  return branch;
}

const isBareString = (t) => t?.type === "string" && !t.enum && !t.pattern && !t.format;
const isStringEnum = (t) => t?.type === "string" && Array.isArray(t.enum);
const isPlainObject = (t) => t?.type === "object";

/** True when `oneOf`'s branches can overlap on valid data (see rules above). */
function overlaps(oneOf, schemas) {
  const resolved = oneOf.map((b) => resolveBranch(b, schemas));

  if (resolved.some(isBareString) && resolved.some(isStringEnum)) return true;

  const types = new Set(resolved.map((t) => t?.type));
  if (types.has("integer") && types.has("number")) return true;

  const objectBranches = resolved.filter(isPlainObject);
  if (objectBranches.length >= 2 && !objectBranches.some((t) => t.additionalProperties === false)) {
    return true;
  }

  return false;
}

function walk(node, schemas) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, schemas);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node.oneOf) && overlaps(node.oneOf, schemas)) {
    node.anyOf = node.oneOf;
    delete node.oneOf;
  }
  for (const key of Object.keys(node)) walk(node[key], schemas);
}

/** Deep-clone `spec` and rewrite overlap-prone `oneOf` schemas to `anyOf`. */
export function relaxOverlappingOneOf(spec) {
  const clone = JSON.parse(JSON.stringify(spec));
  walk(clone, clone.components?.schemas ?? {});
  return clone;
}
