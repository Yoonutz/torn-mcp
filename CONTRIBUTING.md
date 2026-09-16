# Maintenance guide

A short reference for the tasks that come up most often when maintaining this repo.

## Generated files

The following files are **auto-generated** — do not edit them by hand:

| File | Source of truth | Regenerate with |
|------|----------------|-----------------|
| `src/generated/endpoints.ts` | `openapi.json` + `scripts/lib/catalog.mjs` | `npm run regenerate` |
| `src/generated/manifest.ts` | `openapi.json` + `scripts/lib/catalog.mjs` | `npm run regenerate` |
| `src/generated/types.ts` | `openapi.json` (via `openapi-typescript`) | `npm run regenerate` |
| `scripts/lib/returns-overrides.generated.json` | live Torn API responses | `node scripts/conformance.mjs` (live run) |
| `docs/generated/openapi-changelog.md` | diff of successive `openapi.json` versions | `npm run sync-openapi` |
| `README.md` (tool table section) | `scripts/lib/readme.mjs` | `npm run regenerate` |

The contract test (`src/generated/contract.test.ts`) fails if any committed generated file drifts from `openapi.json`. If you see a contract-test failure after editing `openapi.json` by hand, run `npm run regenerate` to resync.

## How to refresh `openapi.json`

```sh
npm run sync-openapi
```

This downloads the latest Torn OpenAPI spec, regenerates `src/generated/types.ts`, updates the changelog at `docs/generated/openapi-changelog.md`, and regenerates the catalog.

## How to regenerate the TypeScript catalog

```sh
npm run regenerate
```

Equivalent to `npm run generate` — produces `src/generated/endpoints.ts`, `src/generated/manifest.ts`, `src/generated/types.ts`, and updates the README tool table.

## How to update the conformance baseline

The baseline (`conformance-baseline.json`) records Torn's known standing spec bugs so the weekly conformance run only fails on **new** drift.

To accept current drift as the new baseline, run the "Refresh conformance baseline" GitHub Actions workflow (the easiest path), or locally:

```sh
TORN_TEST_API_KEY=<key> node scripts/conformance.mjs --update-baseline
```

## How to add a seed for a new id-required endpoint

Edit `scripts/lib/conformance-seeds.mjs` and add an entry to `SEEDS` or `PARAM_SEEDS`. See the existing entries for examples.

If the endpoint cannot be tested with the test key (seasonal event, account-state-dependent, CSV response), add it to `DOCUMENTED_SKIPS` instead with a clear reason.

## How to verify the README sync

The README tool table between `<!-- tools:start -->` and `<!-- tools:end -->` is generated. To verify it is in sync:

```sh
npm test   # the contract test checks this
```

To regenerate it:

```sh
npm run regenerate
```

## How to run the conformance harness

```sh
# Compile-only (no API calls, just validates schema compilation):
node scripts/conformance.mjs --compile

# Full live run (needs TORN_TEST_API_KEY):
TORN_TEST_API_KEY=<key> node scripts/conformance.mjs
```

Outputs: `conformance-report.md`, `conformance-for-torn.md`, `conformance.json`, and `scripts/lib/returns-overrides.generated.json`.

## File map

```
scripts/
  conformance.mjs              coordinator: calls every endpoint, exits 1 on new drift
  generate-endpoints.mjs       builds src/generated/* and updates README
  sync-openapi.mjs             downloads latest openapi.json, runs generate
  lib/
    catalog.mjs                core: parses openapi.json → typed catalog
    readme.mjs                 README marker sync
    conformance-seeds.mjs      SEEDS, PARAM_SEEDS, DOCUMENTED_SKIPS constants
    conformance-report.mjs     buildMainReport, buildDevReport
    conformance-baseline.mjs   reconcileBaseline (new/known/resolved drift)
    conformance-filter.mjs     classifyErrors (drops oneOf false positives)
    conformance-throttle.mjs   rate-limit helpers
    auto-override.mjs          shouldAutoOverride (live shape vs spec)
    dev-findings.mjs           buildDevFindings (forum-ready payloads)
    relax-oneof.mjs            relaxOverlappingOneOf (pre-validation schema fixup)
    returns-overrides.mjs      RETURNS_OVERRIDES (curated manual corrections)
    returns-overrides.generated.json  auto-derived structural drift (live run)
src/generated/
  endpoints.ts                 ENDPOINTS catalog (auto-generated)
  manifest.ts                  MANIFEST counts + specHash (auto-generated)
  types.ts                     TypeScript types from openapi.json (auto-generated)
  contract.test.ts             contract tests: catalog ↔ spec ↔ README
conformance-baseline.json      accepted known drift (Torn spec bugs)
docs/generated/
  openapi-changelog.md         per-sync change log (auto-generated)
  README.md                    explains this directory
```
