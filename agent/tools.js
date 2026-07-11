/**
 * Tool definitions for the debugging agent (Anthropic Messages API schemas).
 *
 * Two groups:
 *  1. Investigation/action tools — the mechanical interface to the codebase.
 *  2. Protocol tools — reasoning steps (hypotheses, confirmations, learnings,
 *     bug completion) are themselves tool calls, so every step of the thought
 *     process lands in the structured log AND can be enforced by the harness.
 */

const TOOL_DEFINITIONS = [
  {
    name: 'list_files',
    description:
      'List files and directories at a path within the project (relative to project root). Use "." or omit for the root.',
    input_schema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Relative directory path, e.g. "src/services". Defaults to project root.' },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read a file with line numbers. Path is relative to project root, e.g. "src/models/cart.js".',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'search_codebase',
    description:
      'Search all application files (src/, tests/, server.js, package.json) for a pattern. Accepts a regex or plain text. Returns file:line matches. Essential for tracing where a field name or function is used across files.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Regex or literal text to search for.' } },
      required: ['query'],
    },
  },
  {
    name: 'get_call_graph',
    description:
      'Trace which functions CALL the named function, and which functions it calls — with file:line locations. Use this to follow data flow across files: when an error surfaces in one file, trace backward to where the data actually originates before forming hypotheses.',
    input_schema: {
      type: 'object',
      properties: { functionName: { type: 'string' } },
      required: ['functionName'],
    },
  },
  {
    name: 'run_tests',
    description:
      'Run the FULL test suite. Returns pass/fail counts plus error messages for every failing test. After you have applied a fix, the harness will evaluate this run as a verification attempt: the target test must pass AND no previously-passing test may break.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'run_specific_test',
    description:
      'Run a single test (or tests matching a name substring) in isolation. Faster feedback than the full suite while investigating — but final verification must use run_tests.',
    input_schema: {
      type: 'object',
      properties: { testName: { type: 'string', description: 'Full or partial test name as reported by the test runner.' } },
      required: ['testName'],
    },
  },
  {
    name: 'run_snippet',
    description:
      'NON-DESTRUCTIVE probe: run a throwaway Node.js script in the project root without editing any application file. The script can require project modules (require("./src/...")) and even drive HTTP flows via supertest. Use this to CONFIRM a hypothesis before committing to a fix — e.g. call the suspect function with known inputs and print what it actually returns. Console output is returned to you.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript source. Runs from a temp file at the project root, so use require("./src/...").' },
        purpose: { type: 'string', description: 'One sentence: what this probe is checking and what output would confirm/refute the hypothesis.' },
      },
      required: ['code', 'purpose'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Apply a code fix to an application source file (src/** or server.js only — tests are read-only ground truth). Each change replaces one exact unique occurrence of old_string with new_string. GUARD: you must have recorded hypotheses and confirmed one via confirm_hypothesis before this tool unlocks; after a failed attempt you must revert_file and record_learning first.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string', description: 'Exact current text (must be unique in the file).' },
              new_string: { type: 'string' },
            },
            required: ['old_string', 'new_string'],
          },
        },
        reason: { type: 'string', description: 'Why this change addresses the ROOT CAUSE (not just the symptom).' },
      },
      required: ['path', 'changes', 'reason'],
    },
  },
  {
    name: 'revert_file',
    description: 'Undo the most recent edit_file on a file (stack-based; call repeatedly to walk back further). Required after a failed fix attempt before trying a new approach.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'diff_check',
    description: 'Show a unified diff of everything that changed in a file since the agent started (across all bugs and attempts).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },

  // ---- protocol tools ----
  {
    name: 'record_hypotheses',
    description:
      'Record 2-3 candidate root causes for the current bug, ranked by likelihood, each with concrete reasoning citing evidence (file:line). Required before any hypothesis testing or editing. Do this only AFTER exploring the relevant code path — hypotheses must cite specific code you have actually read.',
    input_schema: {
      type: 'object',
      properties: {
        hypotheses: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Short id like "H1", "H2".' },
              summary: { type: 'string', description: 'One-sentence statement of the suspected root cause.' },
              suspected_location: { type: 'string', description: 'file:line (or file + function) where the defect is suspected.' },
              reasoning: {
                type: 'string',
                description: 'Why this is plausible: "X pattern usually causes Y symptom, and I see X at Z" — cite actual code you read.',
              },
              likelihood: { type: 'string', enum: ['high', 'medium', 'low'] },
            },
            required: ['id', 'summary', 'suspected_location', 'reasoning', 'likelihood'],
          },
        },
      },
      required: ['hypotheses'],
    },
  },
  {
    name: 'confirm_hypothesis',
    description:
      'Mark one recorded hypothesis as confirmed, with the evidence that confirmed it. Prefer non-destructive verification (run_snippet / run_specific_test) over code reading alone. This unlocks edit_file.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The hypothesis id being confirmed.' },
        method: {
          type: 'string',
          enum: ['snippet_probe', 'isolated_test', 'code_reading'],
          description: 'How it was verified. code_reading is allowed but warrants lower confidence.',
        },
        evidence: { type: 'string', description: 'The concrete observation that confirms it (e.g. probe output showing NaN).' },
        confidence: { type: 'number', description: '0.0-1.0. Direct runtime observation ≈0.9+; code reading alone ≤0.7.' },
      },
      required: ['id', 'method', 'evidence', 'confidence'],
    },
  },
  {
    name: 'record_learning',
    description:
      'After a FAILED fix attempt: state what the failure taught you. Which hypothesis is now ruled out and why, and what the revised thinking is. Required (along with reverting the failed edit) before the next edit attempt.',
    input_schema: {
      type: 'object',
      properties: {
        failed_attempt_summary: { type: 'string', description: 'What was tried and what happened.' },
        what_it_rules_out: { type: 'string', description: '"This rules out hypothesis X because..."' },
        revised_thinking: { type: 'string', description: 'The new/updated hypothesis incorporating this information.' },
      },
      required: ['failed_attempt_summary', 'what_it_rules_out', 'revised_thinking'],
    },
  },
  {
    name: 'finish_bug',
    description:
      'Close out the current bug. status="fixed" triggers independent harness validation (full suite re-run; the target test must pass with zero regressions — do not call this unless your own run_tests already confirmed it). status="needs_human_review" is for after exhausting the attempt budget; all edits must be reverted first.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['fixed', 'needs_human_review'] },
        root_cause: { type: 'string', description: 'The actual root cause (for needs_human_review: best current theory).' },
        fix_summary: { type: 'string', description: 'What was changed and why it addresses the root cause, not the symptom.' },
        files_changed: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number', description: '0.0-1.0 — how directly was the root cause verified vs inferred?' },
        confidence_rationale: { type: 'string' },
        attempts_narrative: {
          type: 'string',
          description: 'For needs_human_review: everything tried, in order, and what each attempt ruled out.',
        },
      },
      required: ['status', 'root_cause', 'fix_summary', 'confidence', 'confidence_rationale'],
    },
  },
];

module.exports = { TOOL_DEFINITIONS };
