# Torn MCP — Roadmap

Current version: **v0.9.7**. Roadmap reflects actual repo state — no drift.

| Phase | Focus | Effort | Status |
|-------|-------|--------|--------|
| **1 — Core server & tools** | MCP server, grouped tools, auth, rate limiting | dev time | ✅ shipped |
| **2 — Intelligence & data correctness** | Aggregation tools, complete data, validation | dev time | ✅ shipped |
| **3 — Lean runtime** | Drop heavy framework, native transport | dev time | ✅ shipped |
| **4 — Observability & ops** | Version reporting, weekly sync, CI, protection | dev time | ✅ shipped |
| **5 — Schema metadata** | Key-level + stability badges | dev time | ✅ shipped |
| **6 — Response schemas** | Type the intelligence layer; expose return shapes | ~8-12h | ✅ shipped |
| **7 — Contract tests** | Prove tools match the spec | ~4-6h | ✅ shipped |
| **8 — Live conformance** | Validate real Torn responses against the schema | ~6-10h | ✅ shipped |
| **9 — Additive enrichment** | Keep canonical data; add views beside it | dev time | ✅ shipped |
| **10 — Canonical output channel** | Schema-true `structuredContent` + human text | ~6-10h | ✅ shipped |

## 🐞 Bug Fixes

Tracks shipped fixes and open bugs. New bugs land as ⏳ Proposed; flip to ✅ with the ship version when fixed.

| Bug | Status | Version | Notes |
|-----|--------|---------|-------|
| Discovery return-shape wrong for drifted endpoints | ✅ Fixed | v0.9.3 | Live-verified overrides correct auctionhouselisting, raidreport, territorywarreport, enlistedcars |
| Conformance seeds broke on three endpoints | ✅ Fixed | v0.9.4 | racing/race seeds a finished race; attacklog + eliminationteam documented as expected skips |
| Four endpoints wrongly marked un-seedable | ✅ Fixed | v0.9.5 | crimes/subcrimes use crime-type ids, itemdetails seeds a UID, attacklog injects a log code |
| Id-scoped endpoints unclear vs list siblings | ✅ Fixed | v0.9.6 | Tool descriptions name the path param (e.g. `trade (requires tradeId)`) instead of generic id |
| Workflows missing least-privilege permissions | ✅ Fixed | v0.9.7 | Add `contents: read` to all three workflows; resolves 4 CodeQL alerts |

## ✨ Features

Tracks shipped features and future ideas. Ideas land as ⏳ Proposed; flip to ✅ with the ship version when done.

| Feature | Status | Version | Notes |
|---------|--------|---------|-------|
| Reality-derived response shapes in discovery | 🟡 In progress | v0.9.3 | Manual live-shape overrides shipped; auto-deriving from conformance still open |

## ✅ Phase 1 — Core server & tools

| Task | Effort | Version | Notes |
|------|--------|---------|-------|
| ✅ Remote MCP server on Cloudflare Workers | dev time | v0.1.0 | Connect any MCP client to live Torn data with just an API key. |
| ✅ Nine grouped tools covering every endpoint | dev time | v0.1.0 | One tool per Torn category; reaches all data endpoints. |
| ✅ Per-request API key from header | dev time | v0.1.0 | The key is never stored or logged; each request carries its own. |
| ✅ Per-key rate limiting | dev time | v0.1.0 | Stays within Torn's 100-calls-per-minute limit automatically. |

**Ships on:** v0.1.0

## ✅ Phase 2 — Intelligence & data correctness

| Task | Effort | Version | Notes |
|------|--------|---------|-------|
| ✅ Twelve intelligence tools | dev time | v0.1.0 | Ready-made summaries: player analysis, war readiness, market deals. |
| ✅ Complete paginated data | dev time | v0.1.0 | Follows result pages and returns everything, never a silent cut. |
| ✅ Human-readable timestamps | dev time | v0.2.0 | Shows Torn City Time instead of raw epoch numbers. |
| ✅ Parameter validation with guidance | dev time | v0.2.0 | Tells the model the allowed values instead of a vague error. |
| ✅ Item name lookup | dev time | v0.4.0 | Accepts an item name like "Xanax" and finds its id for you. |
| ✅ Optional filters surfaced | dev time | v0.4.0 | Shows category filters so results come back useful, not empty. |

**Ships on:** v0.1.0 - v0.4.0

## ✅ Phase 3 — Lean runtime

| Task | Effort | Version | Notes |
|------|--------|---------|-------|
| ✅ Drop heavy framework dependency | dev time | v0.3.0 | Lighter, faster server with zero known security advisories. |

**Ships on:** v0.3.0

## ✅ Phase 4 — Observability & ops

| Task | Effort | Version | Notes |
|------|--------|---------|-------|
| ✅ Version + health endpoints | dev time | v0.2.0 | Anyone can check which Torn API version the server runs. |
| ✅ Weekly spec sync with change report | dev time | v0.2.0 | Auto-detects Torn API changes and reports exactly what moved. |
| ✅ CI checks on every change | dev time | v0.2.0 | Type and test checks run before anything ships. |
| ✅ Protected main branch | external | v0.2.0 | Guards the published code from accidental or unwanted changes. |

**Ships on:** v0.2.0

## ✅ Phase 5 — Schema metadata

| Task | Effort | Version | Notes |
|------|--------|---------|-------|
| ✅ Key-level + stability badges | dev time | v0.5.0 | Flags which key an endpoint needs and warns on unstable ones. |

**Ships on:** v0.5.0

## ✅ Phase 6 — Response schemas

| Task | Effort | Version | Notes |
|------|--------|---------|-------|
| ✅ Type the intelligence tools from response shapes | dev time | v0.6.0 | Catch Torn field renames automatically instead of letting summaries quietly go blank. |
| ✅ Tell the model what each tool returns | ~3-4h | v0.9.0 | Discovery lists each endpoint's response fields; tool descriptions show the return keys. |

**Ships on:** v0.6.0 - v0.9.0
**Unlocks:** model knows the result shape before calling

## ✅ Phase 7 — Contract tests

| Task | Effort | Version | Notes |
|------|--------|---------|-------|
| ✅ Spec contract test suite | dev time | v0.6.1 | Prove every tool calls Torn correctly and stays in sync with the spec. |

**Ships on:** v0.6.1

## ✅ Phase 8 — Live conformance harness

| Task | Effort | Version | Notes |
|------|--------|---------|-------|
| ✅ Conformance harness + weekly workflow | dev time | v0.6.2 | Calls every endpoint weekly and checks the real response matches the schema. |
| ✅ First live run + triage tuning | dev time | v0.8.1 | Ran the full sweep; sorts real drift from spec quirks and input gaps. |
| ✅ Plain-English report | dev time | v0.8.2 | Says which field is wrong and why, grouped so a human can scan it. |
| ✅ Known-drift baseline | dev time | v0.8.3 | Records Torn's standing bugs so the run fails only on new drift, not existing. |
| ✅ One-click baseline refresh | ~1h | v0.9.1 | Manual workflow re-snapshots accepted drift and commits it, with a diff in the run summary. |
| ✅ Documented-skip triage | ~1h | v0.9.2 | Splits expected un-seedable skips from unexpected ones; flags any that become testable. |
| ✅ Upstream spec-issue report | dev time | v0.9.2 | Wrote up the 18 baselined Torn spec bugs for reporting back to Torn. |

**Ships on:** v0.6.2 - v0.9.2
**Found:** ~18 spots where Torn's live data diverges from its own docs (baselined)

## ✅ Phase 9 — Additive enrichment

| Task | Effort | Version | Notes |
|------|--------|---------|-------|
| ✅ Make enrichment non-destructive | dev time | v0.7.0 | Keep the raw value the schema defines and add the readable version beside it. |

**Ships on:** v0.7.0
**Unlocks:** tool output stays close to the validated schema

## ✅ Phase 10 — Canonical output channel

| Task | Effort | Version | Notes |
|------|--------|---------|-------|
| ✅ Emit schema-true data as structured content | dev time | v0.8.0 | The raw data goes in its own channel, kept close to the schema. |
| ✅ Keep the human/summary view as text | dev time | v0.8.0 | Presentation sits beside the contract so consumers pick raw or formatted. |

**Ships on:** v0.8.0
**Unlocks:** tool output validated against the schema; consumers choose raw vs formatted
