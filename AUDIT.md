# DebugMind — Phase 0 Production-Readiness Audit

**Auditor:** staff-level review, read-only pass
**Commit audited:** `3ab1ddf` (local `main`)
**Date:** 2026-07-11
**Method:** static reading of every file under `agent/`, plus **executable probes** that attempt to
break each guardrail. Findings marked *verified* were reproduced by running code, not inferred.
Probe scripts were run outside the repo and the working tree was confirmed clean afterwards.

---

## 0. Security gate

| Check | Result |
|---|---|
| `.env` tracked by git? | **No** |
| Key material in working tree | Only `.env` (untracked, correctly ignored) |
| Key material anywhere in **full history** (every blob, all refs) | **None** — clean |
| `.gitignore` covers `.env` | Yes |
| `.gitignore` covers `.env.*` (e.g. `.env.local`) | **No — gap** |

**No rotation required.** The repository has never contained a key. Two follow-ups for Phase 1:
add `.env.*` to `.gitignore`, and commit a `.env.example`.

> ⚠️ **Unrelated but blocking:** local `main` is **1 commit behind** `origin/main`
> (`6f75be6 Update README.md`, made on GitHub). Fast-forward before branching Phase 1, or that
> edit will be lost in a later force-push.

---

## 1. Agent state machine

One `BugSession` per failing test. The orchestrator re-runs the suite between sessions and
recomputes the queue, so each session starts from a fresh baseline.

```mermaid
stateDiagram-v2
    [*] --> Baseline: orchestrator runs full suite
    Baseline --> Intake: pick first failing test
    Intake --> Exploration: read test, read failure output
    Exploration --> Hypothesis: call graph / search / read files

    Hypothesis --> Testing: record_hypotheses (>=2 required)
    Testing --> Confirmed: confirm_hypothesis
    Testing --> Hypothesis: probe refutes

    Confirmed --> Fix: edit_file UNLOCKED
    Fix --> Verify: run_tests (full suite)

    Verify --> Validate: target passes AND zero regressions
    Verify --> Failed: target fails OR regression

    Failed --> Cleanup: attempts++ ; edit_file RE-LOCKED
    Cleanup --> Hypothesis: revert_file AND record_learning
    Cleanup --> Exhausted: attempts >= 4

    Validate --> Done: finish_bug(fixed) + independent re-run
    Validate --> Failed: independent re-run disagrees

    Exhausted --> Review: finish_bug(needs_human_review)
    Review --> [*]: session-start state restored
    Done --> [*]: fix retained, cross-bug diff computed

    Intake --> Review: API error / turn cap (45) / content block
```

**Enforcement points (all in `agent/session.js`):** edit lock `:170`, post-failure re-lock `:177`,
attempt counter `:149`, independent validation `:268`, budget exhaustion `:158`, forced restore `:425`.

---

## 2. Tool inventory and guard conditions

14 tools are exposed to the model (`agent/tools.js`). "Guard" = what the harness enforces in code,
independent of the prompt.

| # | Tool | `tools.js` | Guard enforced in code | Verdict |
|---|---|---|---|---|
| 1 | `list_files(directory)` | `:13` | `isVisible()` hides agent internals | Holds (case-sensitive — see B2) |
| 2 | `read_file(path)` | `:24` | root-escape check + `isVisible()` | Holds (case-sensitive — see B2) |
| 3 | `search_codebase(query)` | `:33` | scope-limited to `src/`, `tests/`, 3 root files | Holds; unbounded regex (see F6) |
| 4 | `get_call_graph(fn)` | `:43` | read-only AST parse | Holds |
| 5 | `run_tests()` | `:53` | **verification verdict computed by harness** | Holds |
| 6 | `run_specific_test(name)` | `:59` | regex-escaped `-t` filter | Holds |
| 7 | `run_snippet(code, purpose)` | `:69` | **none — arbitrary Node execution** | ❌ **B1: total bypass** |
| 8 | `edit_file(path, changes)` | `:82` | allow-list + hypothesis lock + failure lock | Holds for this tool |
| 9 | `revert_file(path)` | `:106` | stack pop, falls back to session start | Holds |
| 10 | `diff_check(path)` | `:115` | tracked-file check | Holds |
| 11 | `record_hypotheses(...)` | `:126` | rejects fewer than 2 | Holds (count only, not quality) |
| 12 | `confirm_hypothesis(...)` | `:155` | id must match a recorded hypothesis | ⚠️ **B3: method unverified** |
| 13 | `record_learning(...)` | `:174` | sets `learningRecorded` | Holds |
| 14 | `finish_bug(...)` | `:188` | independent full-suite re-run | Holds (but see B1) |

---

## 3. Bypass analysis — where the harness can be defeated

**This is the most important section of the audit.** Each claimed guardrail is traced to code and
attacked.

### B1 — `run_snippet` is an unsandboxed escape hatch that voids *every* file guardrail — **CRITICAL, verified**

`agent/snippet.js:16` spawns `process.execPath` on model-authored source with **no sandbox, no
allow-list, no syscall restriction, and inherited environment**:

```js
const res = spawnSync(process.execPath, [snippetPath], { cwd: projectRoot, timeout: 30000, ... });
```

Verified by execution:

| Probe | Result |
|---|---|
| Snippet reads `.env` (which `read_file` blocks) | **YES** — 54 bytes read |
| Snippet **writes to `tests/cart.test.js`** | **YES** — file mutated on disk, marker confirmed present |
| Snippet has write access to `agent/session.js` (the harness itself) | **YES** |
| Snippet sees `GEMINI_API_KEY` from the parent process | **YES** — 44 chars, `AIza…` prefix |
| Snippet has `child_process` and outbound `https` | **YES** |

*(All probe mutations were reverted; `git status` clean.)*

**Why this is the top finding:** the project's entire thesis is "tests are read-only ground truth."
A model that writes to `tests/` through `run_snippet` makes the target test pass, and then
`run_tests` reports green, and `finish_bug(fixed)`'s "independent validation" at `session.js:268`
**also** reports green — because it re-runs the same tampered suite. The verification chain does not
merely fail to detect the cheat; it actively certifies it. The guarantee is currently *cultural*
(the model has no reason to cheat) rather than *architectural*.

There is no evidence any run has done this. That is luck and a well-behaved model, not a control.

### B2 — Visibility guard is case-sensitive on a case-insensitive filesystem — **HIGH, verified**

`fileOps.js:29` does `HIDDEN.has(top)` against a lowercase set; NTFS resolves any casing.

| Path | Expected | Actual |
|---|---|---|
| `agent/index.js` | blocked | blocked ✅ |
| `AGENT/index.js` | blocked | **readable** ❌ |
| `Agent/llm.js` | blocked | **readable** ❌ |
| `./agent/llm.js` | blocked | blocked ✅ (normalised) |

The model can read its own harness — `session.js` guard logic, `prompts.js`, `report.js` scoring —
by changing one letter's case. Not exploited in practice, but it is a defeated control, and on an
LLM-agent project the ability of the agent to read its own grader is precisely the interesting
failure mode.

Related: `HIDDEN` matches `.env` exactly, so **`.env.local` / `.env.production` are not hidden**
(verified: rejected only with "does not exist", not "off-limits").

### B3 — Verification *method* is self-asserted, so the confidence score is model-controlled — **HIGH, verified**

`confirm_hypothesis` accepts `method: "snippet_probe"` at face value (`session.js:216-231`); the
harness never cross-checks the `snippetProbes` counter it already maintains at `session.js:81`.
Verified: `handleConfirmHypothesis` contains no reference to `snippetProbes`.

This matters because `report.js:11-14` bases the headline confidence number on that field
(`snippet_probe: 85`, `isolated_test: 78`, `code_reading: 60`). The report presents this as
*verification-based* confidence explicitly contrasted with model self-reporting — but the input is
model self-reported. **The project's most defensible metric currently rests on an unverified claim.**
Cheap fix: reject `snippet_probe` unless `snippetProbes` increased since the hypothesis was recorded.

### B4 — Attempt budget only counts *verified* failures — **MEDIUM**

`this.attempts` increments solely at `session.js:149` (failed `run_tests`) and `:287` (rejected
`finish_bug`). After a *successful* edit, `pendingFailure` is null, so the model may call
`edit_file` repeatedly without ever running tests. The budget is therefore "4 failed verifications,"
not "4 fix attempts." Bounded only by `MAX_TURNS = 45` (`session.js:7`). Honest framing for the
README/interview: it is an attempt-*verification* budget.

### B5 — Verification gating can be sidestepped by self-reverting — **MEDIUM**

`handleRunTests` (`session.js:127-130`) classifies a run as informational when
`modifiedSinceSessionStart()` is empty. A model that edits, then uses `edit_file` to restore the
original text (rather than `revert_file`), returns the tree to baseline — a subsequent `run_tests`
is then scored as informational and **no attempt is counted**, despite a real fix cycle having
occurred. Low likelihood, but it is a hole in the accounting the benchmark will depend on.

### B6 — `isEditable()` is unsafe in isolation — **LOW (latent, currently unreachable)**

`isEditable("src/../tests/x.js")` returns `true` (raw `startsWith('src/')`, `fileOps.js:23`).
**Verified not exploitable today**: `editFile` calls `resolve()` first, which normalises via
`path.relative`, so all three traversal spellings were correctly blocked. Recording it because the
function is *exported* (`fileOps.js:251`) and one future caller that forgets to normalise re-opens
the test-tampering path. Normalise inside `isEditable` itself.

### Guardrails that genuinely hold

Verified working, and they are the good part of this codebase:

- **Edit lock before confirmed hypothesis** (`session.js:170`) — enforced in code, not just prompted.
- **Post-failure re-lock** requiring revert *and* learning (`session.js:177`), cleared only when both
  conditions are met (`:246`).
- **`edit_file` allow-list** — `tests/`, `package.json`, `agent/`, and `../` escapes all correctly
  rejected (verified, 4/4).
- **Independent validation** on `finish_bug(fixed)` (`session.js:268`) — the harness re-runs the
  suite rather than trusting the model, and demotes a false claim to a failed attempt (`:286`).
- **Regression definition is correct** — `evaluateFullRun` (`:40`) compares against tests passing at
  *session* start, so pre-existing failures aren't misread as regressions.
- **Forced restore** on review handoff (`:312`) and on any abort (`:425`).

---

## 4. Failure modes

| # | Failure mode | Location | Impact |
|---|---|---|---|
| F1 | Snippet escape (B1) | `snippet.js:16` | Integrity of every result |
| F2 | No `MockProvider` → every test path needs a live key | `llm.js` | CI impossible today |
| F3 | Unbounded context growth: `contents` only ever appended (`session.js:337-398`), no truncation or summarisation | `session.js` | Long sessions hit `MAX_TOKENS`, degrade, then burn turns on the truncation nudge (`:368`) |
| F4 | No wall-clock budget, no token/cost ceiling; `logger` accumulates tokens (`logger.js:221`) but nothing aborts | `logger.js`, `session.js` | A pathological run can exhaust a free-tier quota — **already observed**: the `gemini-3-flash` run died at 20 req/day mid-session |
| F5 | Non-determinism: no `temperature`, no seed, model id unpinned (`gemini-3.1-flash-lite`, a *preview* alias) | `llm.js:116-123` | Runs are not reproducible; benchmark numbers won't be defensible |
| F6 | `new RegExp(query)` from model input with no complexity limit or timeout | `fileOps.js:141` | ReDoS — a pathological pattern hangs the agent |
| F7 | CRLF fragility: `core.autocrlf=true` and files committed with LF, so a **fresh Windows clone gets CRLF**; `edit_file` does exact `indexOf` matching (`fileOps.js:198`) | `fileOps.js` | Plausible that every `edit_file` fails for a reviewer who clones the repo — untested, must be verified |
| F8 | Logger rewrites the entire JSON log on **every event** (`logger.js:58,72`) | `logger.js` | O(n²) I/O; 207 events → 207 full rewrites |
| F9 | Tool results truncated at 20 000 chars into the committed log (`logger.js:151`); anything a snippet prints is persisted and committed | `logger.js` | A snippet that prints `.env` would commit the key |
| F10 | Turn-cap closure can report `status: "fixed"` with a harness-authored root cause (`session.js:403-418`) | `session.js` | Report quality silently degrades; confidence hardcoded 0.7 |
| F11 | `MAX_BUG_SESSIONS = 6` (`orchestrator.js:9`) silently truncates the queue | `orchestrator.js` | A 12-bug benchmark **cannot complete** until this is raised |
| F12 | `.agent-snippet.js` written into the repo root and deleted in `finally` (`snippet.js:13,30`); a hard kill leaves it behind | `snippet.js` | Gitignored, so cosmetic |
| F13 | Zero tests over `agent/` — verified: no file in `tests/` references it | — | The guardrails have no regression protection |

---

## 5. Top 10 riskiest lines

| Rank | Location | Why |
|---|---|---|
| 1 | `agent/snippet.js:16` | Unsandboxed `spawnSync` on model-authored code with inherited env — voids every other control (B1) |
| 2 | `agent/session.js:268` | "Independent validation" re-runs a suite the model can rewrite via B1; certifies the cheat |
| 3 | `agent/fileOps.js:29` | Case-sensitive `HIDDEN` check on a case-insensitive FS (B2) |
| 4 | `agent/session.js:224` | Stores model-asserted `method` unchecked → drives the confidence metric (B3) |
| 5 | `agent/report.js:33` | Computes headline confidence from that unverified field |
| 6 | `agent/session.js:149` | Sole attempt increment — defines the budget's real semantics (B4) |
| 7 | `agent/fileOps.js:198` | Exact-match `indexOf` edit engine — silent total failure under CRLF (F7) |
| 8 | `agent/fileOps.js:141` | Unbounded `RegExp` from model input (F6) |
| 9 | `agent/llm.js:116-123` | No temperature/seed/pinned model — reproducibility blocker for the benchmark (F5) |
| 10 | `agent/orchestrator.js:9` | `MAX_BUG_SESSIONS = 6` — hard blocker for a 12-bug suite (F11) |

---

## 6. Honest assessment

**What is genuinely good.** The protocol is enforced in the harness rather than requested in the
prompt, and that distinction is real: `edit_file` is mechanically locked until a hypothesis is
recorded and confirmed, re-locked after a failure until the model both reverts and writes down what
it learned, and `finish_bug(fixed)` is re-validated by an independent suite run that demotes false
claims to failed attempts. Regressions are measured against session-start state, so the "no
regressions" claim is meaningful rather than decorative. Making the reasoning steps *themselves*
tool calls — hypotheses, confirmations, learnings — is a genuinely thoughtful design decision: it
makes the protocol both machine-checkable and fully auditable, and I would defend it in a review.
The observed behaviour supports it: across two runs the agent traced a cross-file `NaN` to its
production site rather than patching the crash site, and confirmed it with a runtime probe before
editing.

**What is currently only a claim.** Three things. First, the "read-only ground truth" guarantee —
the load-bearing claim of the whole project — is **not** architecturally enforced, because
`run_snippet` can write to `tests/` and I verified that it does. Second, the "verification-based,
not self-reported" confidence score **is** partly self-reported, because the harness never checks
that the probe it credits actually ran. Third, and most important for the resume: there is **no
benchmark**. There are 3 bugs in 1 fixture, no `npm run bench`, no CI of any kind, no
guarded-vs-unguarded comparison, and zero tests covering `agent/`. Two successful runs is an
anecdote, not evidence. The repo today proves the agent *can* work; it does not measure *how often*,
*at what cost*, or *whether the guardrails help* — and those are exactly the questions an
interviewer will ask.

---

## 7. Resume claim status (honesty contract §3)

> "benchmarked against a multi-bug fixture suite executed in CI"

**Not yet true — do not ship this bullet.** Specifically:

| Words | Backed today? |
|---|---|
| "benchmarked" | ❌ No benchmark harness, no metrics from a controlled run |
| "multi-bug fixture suite" | ⚠️ Partially — 3 bugs, 1 fixture, not 12 across categories |
| "executed in CI" | ❌ No CI exists |

Phase 2 makes the first two true; Phase 6 makes the third true. Until then the defensible
formulation is something like *"harness-enforced debugging agent with guardrails that lock editing
behind verified hypotheses; validated on a 3-bug Express fixture across repeated runs."* That is
modest and completely true.

---

## 8. Recommended remediation order

Phase 1 as specified, with three additions promoted into it because they are correctness issues,
not hardening:

1. **Sandbox or constrain `run_snippet`** (B1) — at minimum: strip `GEMINI_API_KEY` from the child
   env, and re-verify integrity by hashing `tests/` before and after every snippet, failing the
   session on mismatch. A full sandbox is better; the hash check is cheap and closes the cheat path.
2. **Case-normalise `isVisible`/`isEditable`, and hide `.env*` by prefix** (B2, B6).
3. **Cross-check `confirm_hypothesis` against the probe counter** (B3) — makes the confidence metric
   honest, which the whole report depends on.
4. Then: provider abstraction + `MockProvider`, run manifest with pinned model/temperature/prompt
   hash, cost ceiling, context strategy, and raise `MAX_BUG_SESSIONS`.

---

*Phase 0 complete. No source file was modified; `git status` is clean.*
