// @license MIT
// Baseline reconciliation for the conformance harness.
//
// Result statuses, by evidence they carry:
//   "compilable" / "schema-error" - compile-check only, NO call was made
//   "pass"                        - a live call was validated and matched
//   "fail"                        - a live call was validated and drifted (reasons[])
//   "smell"                       - a live call hit an ambiguous oneOf only
//   "skip"                        - not tested (no seed / Torn error / CSV)
//
// A baseline entry (accepted Torn drift) can only be called "resolved" when
// there is runtime evidence for that endpoint: a "pass", or a "fail" whose
// reasons no longer include it. Compile-only runs, skips and endpoints absent
// from the run yield "notEvaluated" — never "resolved".

/** Loose reason matching: case, dash variants and whitespace do not count. */
export const normReason = (s) => s.toLowerCase().replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();

/**
 * @param results  harness results: { ep, status, reasons?, note? }[]
 * @param baseline accepted drift: { [ep]: string[] }
 * @param opts     { compileOnly } — true when no live call was made this run
 * @returns { newDrift, knownDrift, resolved, notEvaluated }
 */
export function reconcileBaseline(results, baseline, { compileOnly = false } = {}) {
  const newDrift = []; // drift not in the baseline → fails the run
  const knownDrift = []; // drift already accepted → reported, not fatal
  const resolved = []; // baseline reasons no longer observed, with runtime evidence
  const notEvaluated = []; // baseline entries this run produced no evidence for

  for (const r of results) {
    if (r.status !== "fail") continue;
    const accepted = (baseline[r.ep] ?? []).map(normReason);
    const fresh = (r.reasons ?? []).filter((x) => !accepted.includes(normReason(x)));
    if (fresh.length) {
      r.newReasons = fresh;
      newDrift.push(r);
    } else {
      knownDrift.push(r);
    }
  }

  for (const [ep, reasons] of Object.entries(baseline)) {
    if (compileOnly) {
      notEvaluated.push({ ep, why: "compile-check run: no live call made" });
      continue;
    }
    const cur = results.find((r) => r.ep === ep);
    if (!cur) {
      notEvaluated.push({ ep, why: "not in this run" });
      continue;
    }
    if (cur.status === "pass") {
      resolved.push({ ep, gone: reasons });
      continue;
    }
    if (cur.status === "fail") {
      const stillThere = (cur.reasons ?? []).map(normReason);
      const gone = reasons.filter((x) => !stillThere.includes(normReason(x)));
      if (gone.length) resolved.push({ ep, gone });
      continue;
    }
    // skip / smell / compilable / schema-error: no validated live response.
    notEvaluated.push({ ep, why: `${cur.status}${cur.note ? `: ${cur.note}` : ""}` });
  }

  return { newDrift, knownDrift, resolved, notEvaluated };
}
