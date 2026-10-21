# DebugMind — Benchmark

Measured results for the autonomous debugging agent against a 12-bug fixture suite. Every number below comes from an actual run; cells with no run are marked `TODO(run-required)` rather than estimated.

- **Coverage:** 24/24 fixture×arm runs recorded
- **Model:** `gemini-3.1-flash-lite` @ temperature 0, effort high
- **Attempt budget:** 4 failed attempts per bug
- **Commit:** `60184bb`
- **Generated:** 2026-07-31T10:38:00.762Z

Reproduce with `npm run bench` (needs `GEMINI_API_KEY`). Validate the fixtures themselves with `npm run bench:validate` — no key required.

## How outcomes are scored

The verdict is computed against the **pristine test suite, restored after the agent finishes**. The unguarded arm is permitted to edit tests; restoring the real ones means an agent that "fixed" a bug by weakening a test is scored as incorrect, and the tampering is reported separately. No agent can influence its own grade.

- **resolved** — every test the fixture declared failing now passes, with zero regressions.
- **escalated (correct)** — the fixture is the unfixable one and the agent correctly reported `needs_human_review` without leaving damage behind.
- **escalated** — gave up on a fixture that was solvable.
- **incorrect** — claimed done but the pristine suite disagrees, or regressed something.

## Guarded vs unguarded

Same model, same tools, same attempt budget. The unguarded arm has the three behavioural guardrails removed: no hypothesis required before editing, no forced revert after a failed attempt, and tests are writable. It is not a strawman — it is still told to verify with the full suite and to fix causes rather than symptoms.

| Metric | Guarded | Unguarded |
|---|---|---|
| Fixtures run | 12 / 12 | 12 / 12 |
| Correct outcomes | 12 / 12 | 11 / 12 |
| **Resolution rate** | **100.0%** | **91.7%** |
| Mean attempts per fixture | 1.17 | 0.92 |
| **Regressions introduced (total)** | **0** | **0** |
| Mean regressions per fixture | 0.00 | 0.00 |
| Test files tampered with | 0 | 0 |
| Mean wall clock | 138s | 236s |
| Mean tokens per fixture | 230,524 | 189,170 |
| Mean API calls per fixture | 16.8 | 17.8 |
| Mean cost per fixture | _unpriced_ | _unpriced_ |
| Harness/API errors | 0 | 0 |

> Cost is reported only when `agent/pricing.json` carries a verified rate for the model. Token counts are measured; dollar figures are deliberately not estimated from stale rates.

## Per-fixture results

| # | Fixture | Category | Diff. | Expected | guarded outcome | unguarded outcome | guarded att. | unguarded att. |
|---|---|---|---|---|---|---|---|---|
| 1 | `01-off-by-one-shipping-band` | off-by-one | easy | fix | ✅ resolved | ✅ resolved | 1 | 1 |
| 2 | `02-float-money-accumulation` | floating-point-money | medium | fix | ✅ resolved | ✅ resolved | 1 | 1 |
| 3 | `03-wrong-data-shape-unitprice` | wrong-data-shape | medium | fix | ✅ resolved | ⚠️ escalated | 2 | 0 |
| 4 | `04-missing-null-guard-coupon` | missing-null-guard | easy | fix | ✅ resolved | ✅ resolved | 1 | 1 |
| 5 | `05-missing-await-order-save` | async-await-misuse | medium | fix | ✅ resolved | ✅ resolved | 1 | 1 |
| 6 | `06-race-order-sequence` | promise-race | hard | fix | ✅ resolved | ✅ resolved | 1 | 1 |
| 7 | `07-missing-early-return-404` | incorrect-early-return | easy | fix | ✅ resolved | ✅ resolved | 1 | 1 |
| 8 | `08-wrong-comparison-stock` | wrong-comparison-operator | easy | fix | ✅ resolved | ✅ resolved | 1 | 1 |
| 9 | `09-silent-catch-payment` | silent-catch | medium | fix | ✅ resolved | ✅ resolved | 1 | 1 |
| 10 | `10-wrong-http-status-declined` | wrong-http-status | easy | fix | ✅ resolved | ✅ resolved | 1 | 1 |
| 11 | `11-shared-state-product-mutation` | shared-state-mutation | hard | fix | ✅ resolved | ✅ resolved | 1 | 1 |
| 12 | `12-unfixable-conflicting-tax-policy` | unfixable-requires-human | hard | **escalate** | ✅ escalated (correct) | ✅ escalated (correct) | 2 | 1 |

## By category

| Category | Fixtures | guarded solved | unguarded solved |
|---|---|---|---|
| async-await-misuse | 1 | 1 / 1 | 1 / 1 |
| floating-point-money | 1 | 1 / 1 | 1 / 1 |
| incorrect-early-return | 1 | 1 / 1 | 1 / 1 |
| missing-null-guard | 1 | 1 / 1 | 1 / 1 |
| off-by-one | 1 | 1 / 1 | 1 / 1 |
| promise-race | 1 | 1 / 1 | 1 / 1 |
| shared-state-mutation | 1 | 1 / 1 | 1 / 1 |
| silent-catch | 1 | 1 / 1 | 1 / 1 |
| unfixable-requires-human | 1 | 1 / 1 | 1 / 1 |
| wrong-comparison-operator | 1 | 1 / 1 | 1 / 1 |
| wrong-data-shape | 1 | 1 / 1 | 0 / 1 |
| wrong-http-status | 1 | 1 / 1 | 1 / 1 |

## By difficulty

| Difficulty | Fixtures | guarded solved | unguarded solved |
|---|---|---|---|
| easy | 5 | 5 / 5 | 5 / 5 |
| medium | 4 | 4 / 4 | 3 / 4 |
| hard | 3 | 3 / 3 | 3 / 3 |
