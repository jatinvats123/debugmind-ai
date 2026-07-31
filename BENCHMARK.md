# DebugMind — Benchmark

Measured results for the autonomous debugging agent against a 12-bug fixture suite. Every number below comes from an actual run; cells with no run are marked `TODO(run-required)` rather than estimated.

- **Coverage:** 1/1 fixture×arm runs recorded
- **Model:** `gemini-3.1-flash-lite` @ temperature 0, effort high
- **Attempt budget:** 4 failed attempts per bug
- **Commit:** `f1d4fa0`
- **Generated:** 2026-07-31T09:17:57.049Z

Reproduce with `npm run bench` (needs `GEMINI_API_KEY`). Validate the fixtures themselves with `npm run bench:validate` — no key required.

## How outcomes are scored

The verdict is computed against the **pristine test suite, restored after the agent finishes**. The unguarded arm is permitted to edit tests; restoring the real ones means an agent that "fixed" a bug by weakening a test is scored as incorrect, and the tampering is reported separately. No agent can influence its own grade.

- **resolved** — every test the fixture declared failing now passes, with zero regressions.
- **escalated (correct)** — the fixture is the unfixable one and the agent correctly reported `needs_human_review` without leaving damage behind.
- **escalated** — gave up on a fixture that was solvable.
- **incorrect** — claimed done but the pristine suite disagrees, or regressed something.

## Guarded vs unguarded

Same model, same tools, same attempt budget. The unguarded arm has the three behavioural guardrails removed: no hypothesis required before editing, no forced revert after a failed attempt, and tests are writable. It is not a strawman — it is still told to verify with the full suite and to fix causes rather than symptoms.

| Metric | Guarded |
|---|---|
| Fixtures run | 1 / 1 |
| Correct outcomes | 1 / 1 |
| **Resolution rate** | **100.0%** |
| Mean attempts per fixture | 1.00 |
| **Regressions introduced (total)** | **0** |
| Mean regressions per fixture | 0.00 |
| Test files tampered with | 0 |
| Mean wall clock | 74s |
| Mean tokens per fixture | 58,700 |
| Mean API calls per fixture | 9.0 |
| Mean cost per fixture | _unpriced_ |
| Harness/API errors | 0 |

> Cost is reported only when `agent/pricing.json` carries a verified rate for the model. Token counts are measured; dollar figures are deliberately not estimated from stale rates.

## Per-fixture results

| # | Fixture | Category | Diff. | Expected | guarded outcome | guarded att. |
|---|---|---|---|---|---|---|
| 1 | `01-off-by-one-shipping-band` | off-by-one | easy | fix | ✅ resolved | 1 |

## By category

| Category | Fixtures | guarded solved |
|---|---|---|
| off-by-one | 1 | 1 / 1 |

## By difficulty

| Difficulty | Fixtures | guarded solved |
|---|---|---|
| easy | 1 | 1 / 1 |
