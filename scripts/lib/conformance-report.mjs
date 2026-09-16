// @license MIT
// Report builders for the conformance harness. Separated from runner logic so
// report format can evolve without touching validation or CI exit-code behavior.
//
// Exports:
//   buildMainReport(opts)  — maintenance Markdown (baselines, seeds, skip lists)
//   buildDevReport(opts)   — forum/upstream Markdown written for Torn's devs

/**
 * Build the human-first maintenance report (CI step-summary + conformance-report.md).
 *
 * @param {object} opts
 * @param {object} opts.catalog           - built catalog
 * @param {object[]} opts.results         - harness result rows
 * @param {object[]} opts.pass            - passing results
 * @param {object[]} opts.newDrift        - newly drifted results
 * @param {object[]} opts.knownDrift      - known-drift results
 * @param {object[]} opts.resolved        - resolved baseline entries
 * @param {object[]} opts.notEvaluated    - baseline entries without evidence
 * @param {object[]} opts.smells          - spec-smell results
 * @param {object[]} opts.skips           - skipped results
 * @param {object[]} opts.documentedSkips - expected skips
 * @param {object[]} opts.unexpectedSkips - unexpected skips
 * @param {object[]} opts.nowTestable     - documented skips that now return data
 * @param {string[]} opts.compileIssues   - schema compile errors
 * @param {object}   opts.DOCUMENTED_SKIPS - skip reason map (ep → string)
 * @param {boolean}  opts.compileOnly     - true when run without a live key
 * @returns {string} Markdown report
 */
export function buildMainReport({
  catalog,
  results,
  pass,
  newDrift,
  knownDrift,
  resolved,
  notEvaluated,
  smells,
  skips,
  documentedSkips,
  unexpectedSkips,
  nowTestable,
  compileIssues,
  DOCUMENTED_SKIPS,
  compileOnly,
}) {
  const lines = [];
  lines.push(`# Torn conformance report`);
  lines.push("");
  lines.push(
    `OpenAPI ${catalog.openapiVersion} · ${results.length} endpoints · mode: ${compileOnly ? "compile-check (no calls)" : "live"}`,
  );
  lines.push("");
  lines.push(
    `**${pass.length} ok** · **${newDrift.length} NEW drift** · ` +
      `${knownDrift.length} known drift · ${smells.length} spec smell · ` +
      `${skips.length} not tested (${unexpectedSkips.length} unexpected)`,
  );

  if (newDrift.length) {
    lines.push("");
    lines.push(`## ❌ NEW drift — fails the run, look at these (${newDrift.length})`);
    lines.push("Not in the baseline — something changed since it was accepted.");
    lines.push("");
    lines.push("| Endpoint | What's new |");
    lines.push("|----------|-----------|");
    for (const r of newDrift) lines.push(`| \`${r.ep}\` | ${(r.newReasons ?? []).join("<br>") || "—"} |`);
  }

  if (resolved.length) {
    lines.push("");
    lines.push(`## ✅ Resolved — Torn fixed these; prune the baseline (${resolved.length})`);
    for (const r of resolved) lines.push(`- \`${r.ep}\`: ${r.gone.join("; ")}`);
  }

  if (notEvaluated.length) {
    lines.push("");
    lines.push(`## ⏸️ Baseline not evaluated — no runtime evidence this run (${notEvaluated.length})`);
    lines.push("These accepted-drift entries were neither confirmed nor resolved; nothing to act on.");
    for (const r of notEvaluated) lines.push(`- \`${r.ep}\`: ${r.why}`);
  }

  if (knownDrift.length) {
    lines.push("");
    lines.push(`## 🟡 Known drift — accepted Torn spec bugs, not failing (${knownDrift.length})`);
    lines.push("| Endpoint | What's wrong |");
    lines.push("|----------|--------------|");
    for (const r of knownDrift) lines.push(`| \`${r.ep}\` | ${(r.reasons ?? []).join("<br>") || "—"} |`);
  }

  if (smells.length) {
    lines.push("");
    lines.push(`## ⚠️ Spec smells — ignore (${smells.length})`);
    lines.push(
      "A schema union whose branches genuinely overlap in a way relax-oneof.mjs doesn't " +
        "already resolve — not real drift, but worth a look. Endpoints: " +
        smells.map((r) => `\`${r.ep}\``).join(", "),
    );
  }

  if (unexpectedSkips.length) {
    lines.push("");
    lines.push(`## ⏭️ Unexpected skips — look at these (${unexpectedSkips.length})`);
    lines.push("Not documented as un-seedable — a seed broke or a new endpoint needs one.");
    lines.push("");
    lines.push("| Endpoint | Why |");
    lines.push("|----------|-----|");
    for (const r of unexpectedSkips) lines.push(`| \`${r.ep}\` | ${r.note ?? ""} |`);
  }

  if (nowTestable.length) {
    lines.push("");
    lines.push(`## 🔓 Now testable — drop from DOCUMENTED_SKIPS (${nowTestable.length})`);
    lines.push(
      "These documented skips returned data this run, so they can be validated: " +
        nowTestable.map((ep) => `\`${ep}\``).join(", "),
    );
  }

  if (documentedSkips.length) {
    lines.push("");
    lines.push(`## 🟦 Expected skips — known un-seedable on the test account (${documentedSkips.length})`);
    lines.push("| Endpoint | Reason | Torn said |");
    lines.push("|----------|--------|-----------|");
    for (const r of documentedSkips) {
      lines.push(`| \`${r.ep}\` | ${DOCUMENTED_SKIPS[r.ep]} | ${r.note ?? ""} |`);
    }
  }

  if (compileIssues.length) {
    lines.push("");
    lines.push(`## Schemas that wouldn't compile (${compileIssues.length})`);
    for (const c of compileIssues) lines.push(`- ${c}`);
  }

  return lines.join("\n");
}

/**
 * Build the upstream-facing dev report (conformance-for-torn.md).
 * Written for Torn's developers: the ask up front, only actionable sections,
 * reasons in backticks so `*` survives markdown rendering.
 *
 * @param {object} opts
 * @param {object} opts.catalog      - built catalog
 * @param {object[]} opts.results    - all harness results
 * @param {object[]} opts.pass       - passing results
 * @param {object[]} opts.newDrift   - newly drifted results
 * @param {object[]} opts.knownDrift - accepted-drift results
 * @param {object[]} opts.skips      - skipped results
 * @param {object[]} opts.resolved   - resolved baseline entries
 * @param {Function} opts.responseRef - (def) → schema $ref name
 * @returns {string} Markdown report
 */
export function buildDevReport({ catalog, results, pass, newDrift, knownDrift, skips, resolved, responseRef }) {
  const epDef = (ep) => {
    const [tag, name] = ep.split("/");
    return catalog.tags?.[tag]?.[name];
  };
  const specPath = (ep) => {
    const def = epDef(ep);
    return def ? (def.path ?? def.idPath) : ep;
  };
  const specSchema = (ep) => {
    const def = epDef(ep);
    return (def && responseRef(def)) || null;
  };

  const devDrift = [
    ...newDrift.map((r) => ({
      ep: r.ep,
      reasons: r.newReasons ?? [],
      evidence: r.evidence ?? {},
      findings: r.devFindings ?? [],
    })),
    ...knownDrift.map((r) => ({
      ep: r.ep,
      reasons: r.reasons ?? [],
      evidence: r.evidence ?? {},
      findings: r.devFindings ?? [],
    })),
  ];
  const csvEndpoints = skips
    .filter((r) => /is not valid JSON/.test(r.note ?? ""))
    .map((r) => r.ep);

  const dev = [];
  dev.push(`# Torn API — OpenAPI spec vs live responses`);
  dev.push("");
  dev.push(
    `An automated check called every GET endpoint in the public OpenAPI spec ` +
      `(v${catalog.openapiVersion}) with a real key and validated each live JSON response ` +
      `against the response schema the spec documents for it. ` +
      `${pass.length} of ${results.length} endpoints matched exactly; the exceptions are below. ` +
      `(Id-scoped and unscoped variants of the same endpoint are counted once, so the total is ` +
      `lower than the spec's raw GET operation count.)`,
  );
  dev.push("");
  dev.push(
    `**The ask: for each endpoint listed, correct the OpenAPI spec so the documented ` +
      `response shape matches what the API actually returns** (or change the response, if the ` +
      `spec is the intended shape). This is documentation drift, not a gameplay bug report — ` +
      `the endpoints all work; their documented types are what's off. It bites anyone ` +
      `generating typed clients or validating responses from the spec.`,
  );

  if (devDrift.length) {
    dev.push("");
    dev.push(`## Spec/response mismatches (${devDrift.length} endpoints)`);
    dev.push("");
    dev.push(
      "Sample payloads are live API v2 responses, trimmed to the relevant branch; " +
        "`// <--` marks the offending line in each payload. " +
        "Endpoint paths and schema names are copied verbatim from `openapi.json`, so both " +
        "can be searched in the spec directly. In each mismatch, the path is where inside " +
        "the JSON response body, and `*` stands for any array index or numeric key.",
    );
    for (const r of devDrift) {
      const sch = specSchema(r.ep);
      dev.push("");
      dev.push(`### \`GET ${specPath(r.ep)}\`${sch ? ` (schema \`${sch}\`)` : ""}`);
      const findings = r.findings.length
        ? r.findings
        : [{ statements: r.reasons.map((x) => `\`${x}\``), payload: null }];
      for (const f of findings) {
        dev.push("");
        dev.push(f.statements.join(";\n") + ":");
        dev.push("");
        if (f.payload) {
          dev.push("```json");
          dev.push(f.payload);
          dev.push("```");
        } else {
          dev.push("Payload omitted - large response; a trimmed sample is available on request.");
        }
      }
    }
  }

  if (csvEndpoints.length) {
    dev.push("");
    dev.push(`## Content-type mismatch (${csvEndpoints.length} endpoints)`);
    dev.push("");
    dev.push(
      "These return CSV while the spec documents an `application/json` response: " +
        csvEndpoints.map((ep) => `\`GET ${specPath(ep)}\``).join(", ") +
        ". If CSV is intended, documenting `text/csv` in the spec would fix it.",
    );
  }

  if (resolved.length) {
    dev.push("");
    dev.push(`## Fixed since the previous run — confirmed live, thank you (${resolved.length})`);
    dev.push("");
    for (const r of resolved) {
      dev.push(`- \`GET ${specPath(r.ep)}\`: ${r.gone.map((x) => `\`${x}\``).join("; ")}`);
    }
  }

  return dev.join("\n") + "\n";
}
