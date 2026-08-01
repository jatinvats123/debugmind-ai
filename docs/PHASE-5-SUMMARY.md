# Phase 5 — Testing the agent itself: what changed and why

Branch: `feat/phase-5-agent-tests` · stacked on `feat/phase-4-observability`
**121 tests · 79.87% statement coverage on `agent/`**

---

## The one-sentence version

The project's central claim — that the debugging protocol is enforced by the
harness rather than requested in the prompt — was unverified until now; these
tests drive the session with **no model involved** and prove the harness refuses
a deliberately uncooperative agent.

---

## Why the guardrail tests are the highest-value tests in the repo

Every other test confirms the code does what it says. These confirm the code
*refuses* what it says it refuses, which is the entire design argument.

They work by driving `BugSession` directly. There is no LLM, no prompt, no
persuasion — the test calls `executeTool('edit_file', …)` as an agent that has
decided to ignore the protocol, and asserts the harness says no.

| README claim | Test |
|---|---|
| Editing is locked until a hypothesis is confirmed | rejects `edit_file` with nothing hypothesised; still rejects with hypotheses recorded but unconfirmed |
| Claimed evidence must be real | a confirmation citing `snippet_probe` when no probe ran is rejected **and does not unlock editing** |
| Tests are ground truth | `tests/` refused, traversal spellings (`src/../tests/…`) refused, and a sandboxed probe cannot write there either |
| Probes are sandboxed | a probe cannot read `.env` or spawn a child process |
| Only `src/**` and `server.js` are editable | `package.json`, `../escape.js`, `.env` all refused; agent internals unreadable **in any casing** |
| Regressions are failures | fixing the target while breaking another test fails the attempt, increments the counter, and re-locks editing |
| Failures must be learned from | editing stays locked after a revert alone — the recorded learning is also required |
| Don't trust the agent's word | a false `finish_bug("fixed")` is rejected and counted as a failed attempt |
| Know when to stop | premature escalation refused; once the budget is spent, escalation succeeds and the repo is byte-identical to baseline |

The fixture is built around a deliberate trap: `shout()` is implemented on top of
`greet()`, so the obvious fix for the failing greet test breaks the passing shout
test. That gives the regression tests a realistic way to produce a regression on
demand rather than contriving one.

## The rest of the suite

- **Tools** — read/list/search, edit (unique, ambiguous, absent, no-create),
  revert stack semantics, `diff_check`, probe execution and credential scrubbing,
  test-runner parsing and deterministic ordering, call graph including
  did-you-mean.
- **Providers** — mock replay, cassette exhaustion, drift detection that names
  the diverging conversation entry, recording, and **a full bug session driven
  entirely from a cassette**. CI never calls a real API.
- **Orchestrator** — the multi-bug loop, cross-bug side-effect detection, budget
  stops, session caps, target filters, and that the report, log, trace and
  archive are all written.
- **Report** — confidence scoring (probe > code-reading, penalised per failed
  attempt, capped below certainty, zero when unresolved), difficulty rating,
  diff condensation, the evidence trail, and a pinned snapshot.
- **Support** — context pruning (pins intake, keeps recent turns verbatim, never
  elides protocol results, pure), budgets (each ceiling, and that an unpriced
  model cannot trip a cost ceiling), manifests, and the JSONL trace.

## Coverage: 79.87%, honestly

```
Statements   : 79.87% ( 1266/1585 )
Branches     : 64.65% (  697/1078 )
Functions    : 77.91% (  194/249  )
Lines        : 82.11% ( 1166/1420 )
```

Above the 70% target. `agent/orchestrator.js` went from **0% to 95%**.

**One file sits at 0%: `agent/index.js`** — the CLI argument-parsing and wiring
layer. It is exercised end-to-end every time `npm run agent:offline` runs, but
not by jest. I left it in the denominator rather than excluding it to flatter the
number; excluding it would report ~84%.

## Three bugs the tests found — all mine, none in the agent

Worth saying plainly, because "tests found nothing" usually means the tests are
weak:

1. **A wrong assumption about `jest -t`.** I asserted an isolated run reports one
   total test. It reports every test in the matched *files*, marking non-matching
   ones skipped. The meaningful assertion is which tests actually executed.
2. **A wrong assumption about the mock provider's identity.** I expected the
   manifest to record `model: "mock"`; it records `mock:cassette.json`. The code
   is right — that is what makes a replayed run traceable to its fixture.
3. **A wrong assumption about queue order.** In the cross-bug test I predicted
   which test would be the target. Since Phase 1 the queue is sorted, so the
   target is whichever test sorts first and the *other* is the side effect. My
   expectation had them backwards.

All three were my errors, corrected in the tests. The agent code was not changed
to make a test pass.

Also fixed: the retry tests originally exceeded jest's 5s default because the
backoff is real seconds. One retry proves the behaviour and keeps CI fast.

## Note for Phase 6

The suite takes ~90s warm and ~5 minutes cold, dominated by the orchestrator
tests — each one spawns real jest runs inside a workspace. That is inherent to
testing a thing whose job is running tests, but it is worth knowing before wiring
CI: the guardrail and unit suites alone run in well under a minute, so CI can
stage them if total time becomes a problem.

## Resume claim status — unchanged

"benchmarked" ✅ · "multi-bug fixture suite" ✅ · "executed in CI" ❌ (Phase 6, next).
