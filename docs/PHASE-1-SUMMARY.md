# Phase 1 — Reliability foundation: what changed and why

Plain-language summary for interview rehearsal. Every claim here is backed by
something in the repo or a command you can re-run.

Branch: `feat/phase-1-reliability` · 11 commits · verified against the live API
and offline.

---

## The one-sentence version

Phase 1 closed three security holes that undermined the project's core claim,
put the agent behind a provider interface so the whole reasoning loop can run
offline with no API key, and made runs reproducible — which is the precondition
for the benchmark in Phase 2 meaning anything.

---

## Part 1: the guardrails were partly theatre. Now they hold.

The audit attacked each guardrail with executable probes. Three failed.

### `run_snippet` could rewrite the tests it was being graded against

The probe tool spawned a Node process with no sandbox and the parent
environment inherited. A probe could read `.env`, POST the API key anywhere, and
**write to `tests/`**.

Why that was fatal rather than untidy: the project's central claim is "tests are
read-only ground truth." If the model edits a test so the target passes, then
`run_tests` reports green — and `finish_bug`'s independent validation re-runs the
same tampered suite and **certifies the cheat**. The verification chain didn't
just fail to catch it; it endorsed it.

Three layers now, in `agent/snippet.js`:

1. **Node's permission model** (`--permission`, Node 22+). Read access is limited
   to `src/`, `tests/`, `node_modules` and `package.json`; there is no write
   permission at all, and no child processes or workers.
2. **Credential scrubbing** — API keys are stripped from the child environment,
   because the permission model does not gate network access.
3. **Integrity verification** — `tests/` and `package.json` are hashed before and
   after every probe. A mismatch fails the tool call and is recorded as a tamper
   event. This is the fallback control on older Node.

Verified: a probe attempting to write a test now gets `ERR_ACCESS_DENIED`, and
`child_process` is denied too.

> **Interview framing:** "The guardrail I was proudest of was bypassable through
> the one tool that runs model-authored code. I found it by attacking my own
> harness rather than reading it. The fix is defence in depth — an OS-level
> sandbox, plus credential scrubbing, plus a hash check that still works if the
> sandbox isn't available."

### The visibility guard was case-sensitive on a case-insensitive filesystem

`agent/index.js` was blocked. `AGENT/index.js` was not — the agent could read its
own harness, including the code that scores it, by changing one letter's case.
Guard checks now normalise (collapse `..`, lowercase) before comparing, and
secrets match by prefix so `.env.local` is covered too.

### The "verification-based" confidence score was self-reported

`confirm_hypothesis` accepted `method: "snippet_probe"` at face value, and that
field drives the headline confidence number in the report. So the metric
advertised as *not* model-self-reported was, in part, exactly that.

The harness now checks the claim against work it observed itself, and requires
the evidence to **post-date** the hypotheses being confirmed, so a stale probe
can't be recycled. `code_reading` remains available as the honest lower-confidence
path.

> **Interview framing:** "I had a metric that sounded rigorous — verification-based
> confidence, explicitly contrasted with the model's own opinion. When I traced it,
> the input was the model's own opinion. Now the harness only credits a probe it
> actually watched run."

---

## Part 2: the agent can now run with no API key

The agent talked to the Gemini SDK directly, so anything that exercised the
reasoning loop needed a live key and a live quota. That's why the guardrails had
no regression tests, and why CI was impossible.

`agent/providers/` now defines an `LLMProvider` interface (`generate`,
`generateWithTools`) with three implementations:

- **GeminiProvider** — the real backend, now with explicit temperature and a
  `resolveModelVersion()` call so a run records the concrete version that served
  it, not just the moving alias.
- **RecordingProvider** — a decorator that captures a real run into a cassette.
  Fixtures come from genuine model behaviour, never hand-written.
- **MockProvider** — replays a cassette with no network and no key.

**The proof it works:** a recorded run and its offline replay produce identical
results — same fix, same 3 attempts, same 21/21, same token totals — with
`GEMINI_API_KEY=invalid-key-offline-proof`:

```
npm run agent:offline
```

The cassette covers 10 of the 14 tools, and because the recorded session needed
three attempts it exercises the *failure* path too: `edit_file` → failed
verification → `revert_file` → `record_learning` → retry. That makes it a real
regression fixture for the guardrails, not just a demo.

> **Interview framing:** "Mock providers usually mean hand-written fake responses
> that drift from reality. Mine are recordings of real runs, and the replay is
> strict — the request hash covers the tool results the harness produced, so if
> the harness changes behaviour the fixture fails loudly instead of quietly
> replaying stale data."

---

## Part 3: two real bugs the strict replay caught

This is the most useful part to talk about, because it's where the work found
problems rather than just adding features.

### Bug 1: tool output varied with unrelated repo edits

The first replay failed at turn 4 of every session. Cause: `list_files` reported
file sizes, and I had edited `.gitignore` between recording and replaying — so
the tool returned different bytes for a change that had nothing to do with the
code under test.

The wrong fix would have been to loosen the matching. The right fix was to remove
the nondeterminism: file sizes carry no debugging signal, so `list_files` no
longer reports them.

### Bug 2: the bug queue order was nondeterministic

The second replay diverged at the *first message*. Jest schedules test files by
its own heuristics and returned them in a different order between two runs of
identical code — so the agent picked a different first bug each time.

That's a reproducibility defect in its own right and a **blocker for Phase 2**:
two benchmark runs of the same commit could attack bugs in different orders,
produce different cross-bug side effects, and yield incomparable numbers. Test
results are now sorted by (file, test name), so the queue is a function of the
code rather than the scheduler. Verified stable across three consecutive runs.

I also made drift self-diagnosing: cassettes store a per-entry hash of the
conversation, so a failure now names the exact entry that diverged. Diagnosing
the first one took a manual log diff; the next one reports itself.

> **Interview framing:** "The strict fixture matching paid for itself immediately.
> It didn't just protect the tests — it surfaced a real nondeterminism in how the
> agent chose which bug to work on, which would have silently corrupted my
> benchmark. I'd rather find that from a failing fixture than from confusing
> benchmark results."

---

## Part 4: reproducibility, budgets, and context

**Run manifest** (`agent/manifest.js`) — every run records the resolved model
version, temperature, and content hashes of the system prompt, tool schemas and
application source, plus Node version and git commit. Without this, when two
benchmark runs disagree you can't tell whether the model moved or your prompt did.

**Budgets** (`agent/budget.js`) — per-step and per-run token accounting with hard
ceilings on tokens, cost, wall-clock and API calls, checked before each provider
call and before each new bug session. An early run died mid-session when the free
tier hit 20 requests/day; ceilings turn that into a clean abort with a recorded
reason instead of a corrupted run.

**On cost, deliberately:** `agent/pricing.json` ships with rates **unset**. Token
counts are measured and real; dollar figures are not reported unless an operator
fills in a verified rate. A hardcoded price would go stale and silently produce
wrong numbers in `BENCHMARK.md`. Unpriced models report cost as `null` with a
reason rather than an invented estimate.

**Context management** (`agent/context.js`) — sessions append every turn and tool
result, and long ones previously degraded into token-limit truncation. The
strategy is *elide, never drop*: the intake message is pinned, recent turns are
kept verbatim, and older bulky tool results are replaced by a placeholder naming
the tool and the size removed — so the record of what was already tried survives.
Harness verdicts, hypotheses, confirmations and learnings are never elided at any
age, because forgetting a failed attempt would let the model repeat it.

---

## Where the resume claim stands

> "benchmarked against a multi-bug fixture suite executed in CI"

Still **not backed**, and Phase 1 did not change that:

| Words | Status after Phase 1 |
|---|---|
| "benchmarked" | ❌ No benchmark harness yet — Phase 2 |
| "multi-bug fixture suite" | ⚠️ Still 3 bugs, 1 fixture — Phase 2 builds 12 |
| "executed in CI" | ❌ No CI yet — Phase 6 (now *possible*, because the mock provider exists) |

Phase 1 built the foundation those claims will stand on. It did not make them
true. Keep that bullet off the resume until Phase 2 and Phase 6 land.

What you *can* say truthfully today: *"Harness-enforced debugging agent whose
guardrails I verified by attacking them — probe execution is OS-sandboxed, tests
are immutable ground truth, and editing is locked behind a hypothesis the harness
watched being confirmed. Runs are reproducible and fully replayable offline from
recorded fixtures."*

---

## Commands a reviewer can run

```bash
npm run agent:smoke      # offline tool-layer checks, no API
npm run agent:offline    # full agent run replayed from a cassette, no API key
npm test                 # the buggy fixture: 14 pass, 7 fail by design
npm run agent            # live run (needs GEMINI_API_KEY)
```
