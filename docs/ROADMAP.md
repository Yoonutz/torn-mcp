# Torn MCP — Roadmap

Current version: **v0.6.0**. Roadmap reflects actual repo state — no drift.

| Phase | Focus | Effort | Status |
|-------|-------|--------|--------|
| **1 — Core server & tools** | MCP server, grouped tools, auth, rate limiting | dev time | ✅ shipped |
| **2 — Intelligence & data correctness** | Aggregation tools, complete data, validation | dev time | ✅ shipped |
| **3 — Lean runtime** | Drop heavy framework, native transport | dev time | ✅ shipped |
| **4 — Observability & ops** | Version reporting, weekly sync, CI, protection | dev time | ✅ shipped |
| **5 — Schema metadata** | Key-level + stability badges | dev time | ✅ shipped |
| **6 — Response schemas** | Type the intelligence layer from the spec | ~8-12h | 🟢 mostly done |
| **7 — Contract tests** | Prove tools match the spec | ~4-6h | ⏳ planned |
| **8 — Key-access pre-check** | Warn on endpoints the key can't use | ~3-5h | ⏸️ parked |

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

## 🟢 Phase 6 — Response schemas

| Task | Effort | Version | Notes |
|------|--------|---------|-------|
| ✅ Type the intelligence tools from response shapes | dev time | v0.6.0 | Catch Torn field renames automatically instead of letting summaries quietly go blank. |
| ⏳ Tell the model what each tool returns | ~3-4h | | Expose expected fields so the model knows results before calling. |

**Ships on:** v0.6.0
**Unlocks:** rename-proof intelligence tools

## ⏳ Phase 7 — Contract tests

| Task | Effort | Version | Notes |
|------|--------|---------|-------|
| ⏳ Spec contract test suite | ~4-6h | | Prove every tool calls Torn correctly and stays in sync with the spec. |

**Trigger to start:** alongside Phase 6

## ⏸️ Phase 8 — Key-access pre-check

| Task | Effort | Version | Notes |
|------|--------|---------|-------|
| ⏸️ Warn before calling out-of-reach endpoints | ~3-5h | | Check the caller's key once and flag endpoints it cannot access. |

**Blocked on:** product decision on whether it's worth the extra call
