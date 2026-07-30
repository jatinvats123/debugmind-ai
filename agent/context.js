/**
 * Context-window management.
 *
 * A bug session appends every model turn and every tool result, so context grows
 * monotonically. Left alone it eventually hits the output limit, at which point
 * the model degrades and burns its remaining turns on truncation nudges — an
 * observed failure mode, not a hypothetical one.
 *
 * Strategy — elide, never drop:
 *
 *   1. The intake message (turn 0) is PINNED. It carries the failing test, the
 *      error output and the attempt budget; losing it loses the task itself.
 *   2. The most recent `keepRecentTurns` turns are kept VERBATIM. Recent tool
 *      output is what the model is actively reasoning about.
 *   3. Older turns are ELIDED IN PLACE: large tool results are replaced by a
 *      one-line placeholder naming the tool and the size of what was removed.
 *      The conversation's shape — which tools ran, in what order, with what
 *      arguments — is preserved, because that sequence is the model's memory of
 *      what it has already tried. Only the bulky payloads go.
 *   4. Protocol-critical results are NEVER elided regardless of age: harness
 *      verdicts, hypothesis records, confirmations and learnings. Eliding these
 *      would let the model forget that an attempt already failed and repeat it.
 *
 * Elision is content-preserving for decisions and lossy only for bulk payloads,
 * which is the trade that keeps long sessions coherent.
 */

const DEFAULTS = {
  keepRecentTurns: 8,
  maxResultChars: 400,
  triggerChars: 120000,
};

/** Tool results that must survive elision — they encode protocol state. */
const PROTOCOL_TOOLS = new Set([
  'record_hypotheses',
  'confirm_hypothesis',
  'record_learning',
  'finish_bug',
  'run_tests',
]);

function partSize(part) {
  return JSON.stringify(part || {}).length;
}

/** Approximate size of the conversation, used to decide whether to prune at all. */
function measure(contents) {
  return JSON.stringify(contents || []).length;
}

/**
 * Return a pruned copy of `contents`. Pure — the caller keeps the full history
 * for logging and sends the pruned copy to the provider.
 */
function pruneContents(contents, options = {}) {
  const { keepRecentTurns, maxResultChars, triggerChars } = { ...DEFAULTS, ...options };
  const originalChars = measure(contents);
  if (originalChars < triggerChars || contents.length <= keepRecentTurns + 1) {
    return { contents, pruned: false, originalChars, prunedChars: originalChars, elidedParts: 0 };
  }

  const firstKeptRecent = Math.max(1, contents.length - keepRecentTurns);
  let elidedParts = 0;

  const out = contents.map((turn, index) => {
    if (index === 0 || index >= firstKeptRecent) return turn; // pinned intake + recent window
    if (!turn || !Array.isArray(turn.parts)) return turn;

    const parts = turn.parts.map((part) => {
      // Preserve the model's own text and tool CALLS: they are the reasoning trail.
      if (!part.functionResponse) return part;

      const name = part.functionResponse.name;
      if (PROTOCOL_TOOLS.has(name)) return part;

      const size = partSize(part);
      if (size <= maxResultChars) return part;

      elidedParts += 1;
      return {
        functionResponse: {
          ...part.functionResponse,
          response: {
            result: `[elided by context manager: ${name} returned ~${size} chars earlier in this session. ` +
              `Re-run the tool if you need the detail again.]`,
          },
        },
      };
    });

    return { ...turn, parts };
  });

  return {
    contents: out,
    pruned: true,
    originalChars,
    prunedChars: measure(out),
    elidedParts,
  };
}

module.exports = { pruneContents, measure, DEFAULTS, PROTOCOL_TOOLS };
