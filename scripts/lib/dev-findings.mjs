// @license MIT
// Turns ajv verbose errors + the live JSON body into forum-ready findings:
// a mismatch statement, a trimmed sample payload, and a one-line closing note.
// Format modeled on the Torn-forum bug-report structure (statement, payload,
// note per finding). Display-only — never used for baseline matching.

const IDENTITY_KEYS = ["id", "name", "title", "username", "code", "position"];

const normPath = (p) => (p || "(root)").replace(/\/\d+/g, "/*");

const liveType = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

const shortJson = (v, max = 60) => {
  let s = JSON.stringify(v);
  if (typeof s === "string" && s.length > max) s = s.slice(0, max - 3) + "...";
  return s;
};

/** Path segments of an ajv instancePath ("/a/0/b" → ["a","0","b"]). */
const segments = (instancePath) => (instancePath || "").split("/").filter((s) => s !== "");

/** Read the value at an instancePath. */
function valueAt(json, segs) {
  return segs.reduce((o, k) => (o == null ? undefined : o[k]), json);
}

/**
 * Context path for an error: the object whose contents we sample.
 * type/enum errors point AT the offending value → parent object.
 * required/additionalProperties point at the object itself.
 */
function contextSegments(e) {
  const segs = segments(e.instancePath);
  if (e.keyword === "type" || e.keyword === "enum") return segs.slice(0, -1);
  return segs;
}

/** Offending key inside the context object, if any. */
function offendingKey(e) {
  if (e.keyword === "type" || e.keyword === "enum") return segments(e.instancePath).at(-1);
  if (e.keyword === "additionalProperties") return e.params?.additionalProperty;
  return null; // required: the key is absent
}

/**
 * Trim a context object: always keep offending keys, then identity keys, then
 * remaining keys while the serialized size stays within budget. Large nested
 * values on non-offending keys are dropped rather than truncated.
 */
function trimObject(obj, offendingKeys, budget) {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const out = {};
  let size = 2;
  const add = (k, force) => {
    if (k in out || !(k in obj)) return;
    const s = JSON.stringify(obj[k]);
    const cost = (s ? s.length : 4) + k.length + 4;
    if (!force && (cost > 120 || size + cost > budget)) return;
    out[k] = obj[k];
    size += cost;
  };
  for (const k of offendingKeys) add(k, true);
  for (const k of IDENTITY_KEYS) add(k, false);
  for (const k of Object.keys(obj)) add(k, false);
  return out;
}

/** Wrap a trimmed context object back into the response's nesting, arrays as single-item. */
function wrapSkeleton(json, ctxSegs, trimmed) {
  let node = trimmed;
  for (let i = ctxSegs.length - 1; i >= 0; i--) {
    const seg = ctxSegs[i];
    const parent = valueAt(json, ctxSegs.slice(0, i));
    node = Array.isArray(parent) ? [node] : { [seg]: node };
  }
  return node;
}

function statement(e) {
  const at = normPath(e.instancePath);
  const key = offendingKey(e);
  switch (e.keyword) {
    case "type":
      return `spec says \`${key ?? at}\` is ${e.params?.type}; API returns ${liveType(e.data)} (at \`${at}\`)`;
    case "required":
      return `spec marks \`${e.params?.missingProperty}\` required (at \`${at}\`); the live response has no such field`;
    case "enum": {
      const allowed = (e.params?.allowedValues ?? []).map((x) => JSON.stringify(x)).join(", ");
      return `spec allows only ${allowed} at \`${at}\`; API returns ${shortJson(e.data)}`;
    }
    case "additionalProperties":
      return `\`${key}\` (at \`${at}\`) is not in the spec`;
    default:
      return `${at}: ${e.message}`;
  }
}

function note(e) {
  switch (e.keyword) {
    case "type": {
      const t = liveType(e.data);
      const article = /^[aeiou]/.test(t) ? "an" : "a";
      const tt = t === "null" ? "null" : `${article} ${t}`;
      return `\`${offendingKey(e)}\` is ${tt}, not the documented ${e.params?.type}.`;
    }
    case "required":
      return `No \`${e.params?.missingProperty}\` key anywhere on the object.`;
    case "enum":
      return `Live value ${shortJson(e.data)} is outside the documented enum.`;
    case "additionalProperties":
      return `\`${offendingKey(e)}\` is present in the live response but undocumented.`;
    default:
      return null;
  }
}

/** Inline marker for an offending payload line, so first-time readers spot it. */
function marker(e) {
  switch (e.keyword) {
    case "type":
      return `// <-- spec says ${e.params?.type}, API returns ${liveType(e.data)}`;
    case "enum":
      return "// <-- not one of the spec's allowed values";
    case "additionalProperties":
      return "// <-- not documented in the spec";
    default:
      return null;
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Append `// <--` markers to the offending lines of a serialized payload.
 * Keyed errors mark their own `"key":` line; required errors mark the line
 * where their containing object opens, since the key itself is absent.
 */
function annotate(payload, errs, ctxSegs) {
  const lines = payload.split("\n");
  const used = new Set();
  const missing = [];
  for (const e of errs) {
    const key = offendingKey(e);
    if (key == null) {
      if (e.keyword === "required" && e.params?.missingProperty) missing.push(e.params.missingProperty);
      continue;
    }
    const m = marker(e);
    if (!m) continue;
    const re = new RegExp(`^\\s*"${escapeRe(key)}": `);
    const idx = lines.findIndex((l, i) => !used.has(i) && re.test(l));
    if (idx >= 0) {
      used.add(idx);
      lines[idx] += ` ${m}`;
    }
  }
  if (missing.length) {
    const label = [...ctxSegs].reverse().find((s) => !/^\d+$/.test(s));
    const re = label ? new RegExp(`^\\s*"${escapeRe(label)}": [\\[{]`) : /^[\[{]/;
    const idx = lines.findIndex((l) => re.test(l));
    const props = [...new Set(missing)].map((p) => JSON.stringify(p)).join(", ");
    const it = missing.length > 1 ? "them" : "it";
    lines[idx >= 0 ? idx : 0] += ` // <-- spec expects ${props} here; the API never returns ${it}`;
  }
  return lines.join("\n");
}

/**
 * Build dev-facing findings from a live JSON body and its ajv errors.
 * Errors sharing a context object merge into one finding with one payload.
 * Returns [{ statements: string[], payload: string|null, notes: string[] }].
 * Payloads are JSON plus `// <--` markers on the offending lines.
 */
export function buildDevFindings(json, errors, { budget = 600 } = {}) {
  // Group by the NORMALIZED context path (indices → *): the same error across
  // many array items is one finding, sampled from the first item that hit it.
  const groups = new Map(); // normalized ctx path → { ctxSegs (first real), errors: [] }
  for (const e of errors) {
    const ctxSegs = contextSegments(e);
    const key = ctxSegs.map((s) => (/^\d+$/.test(s) ? "*" : s)).join("/");
    if (!groups.has(key)) groups.set(key, { ctxSegs, errors: [] });
    groups.get(key).errors.push(e);
  }

  const findings = [];
  for (const { ctxSegs, errors: errs } of groups.values()) {
    const seen = new Set();
    const statements = [];
    const notes = [];
    for (const e of errs) {
      const s = statement(e);
      if (seen.has(s)) continue;
      seen.add(s);
      statements.push(s);
      const n = note(e);
      if (n) notes.push(n);
    }
    let payload = null;
    const ctx = valueAt(json, ctxSegs);
    if (ctx !== undefined) {
      const offKeys = [...new Set(errs.map(offendingKey).filter((k) => k != null))];
      const trimmed = trimObject(ctx, offKeys, budget);
      try {
        payload = JSON.stringify(wrapSkeleton(json, ctxSegs, trimmed), null, 2);
        payload = annotate(payload, errs, ctxSegs);
      } catch {
        payload = null;
      }
      if (payload && payload.length > budget * 4) payload = null; // untrimmable — omit
    }
    findings.push({ statements, payload, notes });
  }
  return findings;
}
