 Autonomous Debugging Agent

Small Express API with products, cart, and checkout endpoints — containing intentional, interconnected bugs — plus an autonomous debugging agent (`agent/`) that finds and fixes them from failing tests.

## Debugging agent

```
npm run agent               # requires GEMINI_API_KEY (env or .env file)
npm run agent -- --restore  # restore the buggy baseline first, then run
npm run agent:smoke         # offline smoke test of the agent's tools (no API)
npm run restore-bugs        # put the intentional bugs back after a run
```

Uses the Gemini API with function calling. Options: `--model <id>` (default `gemini-3.1-flash-lite` — free-tier keys have no quota for 2.5-pro and only 20 req/day for gemini-3-flash), `--effort low|medium|high|xhigh` (maps to the thinking budget; default high = dynamic), `--max-attempts N` (default 4), `--target "<test name substring>"` (debug only matching tests).

The agent works one bug at a time under a harness-enforced protocol: **intake** (read the failing test) → **exploration** (trace the call graph backward to where data originates) → **2-3 ranked hypotheses** with cited evidence → **non-destructive verification** (throwaway probe scripts — no blind editing; the harness literally locks `edit_file` until a hypothesis is confirmed) → **fix** → **full-suite verification** (regressions = failure) → on failure: forced revert + recorded learning, max 4 attempts, then `needs_human_review`. After each fix it re-diffs the failing set for cross-bug side effects.

Every step — reasoning text, hypotheses, probes, edits, reverts, verdicts, token usage — is logged to the console live and to `debug-log.json` (structured). A human-readable summary lands in `debug-report.md`, and each run is archived under `agent-runs/`. Per bug, the report includes a **verification-based confidence score** (0–100%, derived from how the fix was verified: runtime probe > isolated test > code reading, plus independent validation, minus failed attempts), a **before → after diff snippet** of exactly what changed, and an **Easy/Medium/Hard difficulty rating** (weighted by failed attempts, app-code trace depth, and hypothesis churn). `npm run regenerate-report` rebuilds `debug-report.md` from an existing `debug-log.json` without re-running the agent.

Guardrails: tests are read-only ground truth (the agent cannot "fix" a test), only `src/**` and `server.js` are editable, fixed-claim validation is re-run independently by the harness, and `.buggy-baseline/` keeps the pristine buggy state for repeatable runs
## Tests

```
npm test
```
