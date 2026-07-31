# Phase 4 — Observability: what changed and why

Branch: `feat/phase-4-observability` · stacked on `feat/phase-3-demo`

---

## The one-sentence version

The agent already logged everything it did; Phase 4 makes it possible to *read*
— a streaming JSONL trace, a self-contained HTML timeline, and a per-bug
evidence trail that answers "why did it believe that?" rather than just "what did
it do?"

---

## 1. JSONL trace

`debug-trace.jsonl` — one JSON object per line, appended the moment each event
happens, carrying step type, tool name, arguments, result, **latency** and
**per-turn token counts**.

Why a second format when `debug-log.json` already exists: the aggregate document
is convenient to load but useless while a run is in flight and fragile if the
process dies. The trace is:

- **streamable** — `tail -f debug-trace.jsonl` follows a live run
- **greppable** — `grep '"type":"fix_applied"' debug-trace.jsonl`
- **diffable** — two runs of the same fixture diff line by line
- **crash-safe** — a killed run leaves a valid prefix, not a truncated JSON blob

It also fixes a real defect the Phase 0 audit flagged (F8): the logger rewrote
the *entire* log document on every event, which is O(n²) in event count. The
trace is append-only.

## 2. Trace viewer

`npm run trace:view` renders a run as a timeline in **one self-contained HTML
file** — no server, no framework, no build step, no network requests. The data is
embedded, so it opens from disk, can be attached to a bug report, or committed as
an artifact.

Each kind of step renders distinctly: ranked hypotheses with their cited
locations, probes with the output they actually printed, confirmations with
whether the harness corroborated them, unified diffs, reverts, recorded
learnings, and failed attempts. Model thinking and tool calls can be toggled off
to skim the decision path alone.

Example committed at [`docs/examples/sample-trace.html`](examples/sample-trace.html).

## 3. Evidence trail in the report

Each bug now carries a **"why the agent believed this"** section reconstructing
the belief chain in order:

> symptom → what it read and traced → each ranked hypothesis with its cited
> reasoning → **what each probe actually printed** → what confirmed the diagnosis
> and whether the harness corroborated it → what failed and what that ruled out →
> the edit and its justification → independent verification

The important design decision: **it is assembled from logged events, not from the
model's own summary.** The model's account of its reasoning is a claim; the event
log is a record. Where a probe is cited, the trail quotes the output that probe
actually produced — for example `Subtotal: NaN` — so a reviewer can check the
inference rather than take it on trust.

> **Interview framing:** "The report used to tell you the root cause. That's the
> answer, not the reasoning. The evidence trail shows what the agent looked at,
> what it observed at runtime, and which observation turned a guess into a
> diagnosis — and it's built from the event log rather than from the model
> describing itself, because those are different things and only one of them is
> evidence."

---

## What this is worth in review

The guardrails are the interesting design claim, but claims need to be
inspectable. Before this phase, verifying that the agent really probed before
editing meant reading a 3,000-line JSON file. Now it is a timeline you scroll,
and the confirmation entry states in plain language whether the harness watched
the probe run or merely took the model's word.

That also makes the Phase 2 overfitting finding legible: in the viewer you can
see the first honest attempt, the rejection, the recorded learning, and then the
special-cased second attempt with the agent's own note that it was a hack.

---

## Verification

- Trace viewer output checked for self-containment (no external `src`/`href`, no
  `<script src>` or `<link>`), and for rendering every step type: 125 timeline
  steps from a 178-event run.
- Full sweep green: demo suite 14 pass / 7 fail by design, tool smoke checks,
  all 12 benchmark fixtures valid.
- Sample artifacts regenerated from a real run.

## Resume claim status — unchanged

"benchmarked" ✅ · "multi-bug fixture suite" ✅ · "executed in CI" ❌ (Phase 6).
