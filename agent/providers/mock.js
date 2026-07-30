/**
 * MockProvider — replays recorded provider turns from a cassette on disk.
 *
 * This is what makes the agent testable offline and runnable in CI with no API
 * key. It is deliberately strict: a cassette that has drifted from the code
 * under test is a test failure, not something to paper over.
 *
 * Cassette format (fixtures/*.cassette.json):
 *   {
 *     "meta": { "recordedAt", "provider", "model", "temperature",
 *               "systemPromptHash", "toolSchemaHash" },
 *     "turns": [ { "requestHash", "response": <normalised provider response> } ]
 *   }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LLMProvider } = require('./base');

/**
 * Fingerprint of a request. Tool results are included, so a cassette only
 * replays cleanly when the harness produced the same observations as at
 * record time — which is exactly the property a regression test needs.
 */
function hashRequest({ system, toolDefs, contents }) {
  const shape = JSON.stringify({
    system,
    tools: (toolDefs || []).map((t) => t.name).sort(),
    contents,
  });
  return crypto.createHash('sha256').update(shape).digest('hex').slice(0, 16);
}

/**
 * Per-entry hashes of the conversation. Stored alongside the whole-request hash
 * so that when a cassette drifts, the mismatch can be localised to a single
 * turn instead of reported as an opaque whole-request difference — the
 * difference between "something changed" and "tool result X changed".
 */
function hashParts(contents) {
  return (contents || []).map((entry) =>
    crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex').slice(0, 12)
  );
}

/** First index at which two hash lists differ, or -1 when one is simply longer. */
function firstDivergence(recorded, actual) {
  const len = Math.min(recorded.length, actual.length);
  for (let i = 0; i < len; i++) {
    if (recorded[i] !== actual[i]) return i;
  }
  return recorded.length === actual.length ? -1 : len;
}

/** Human-readable summary of a conversation entry, for drift messages. */
function describeEntry(entry) {
  if (!entry || !Array.isArray(entry.parts)) return String(entry && entry.role);
  const bits = entry.parts.map((p) => {
    if (p.functionCall) return `call:${p.functionCall.name}`;
    if (p.functionResponse) return `result:${p.functionResponse.name}`;
    if (p.text) return `text(${p.text.length} chars)`;
    return 'part';
  });
  return `${entry.role}[${bits.join(', ')}]`;
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
}

class MockProvider extends LLMProvider {
  /**
   * @param {object} opts
   * @param {string} opts.cassettePath
   * @param {'strict'|'sequential'} [opts.matchMode] strict = request hash must
   *   match the recorded turn (default); sequential = replay in order and only
   *   warn on drift, useful while iterating on a fixture.
   */
  constructor({ cassettePath, matchMode = 'strict' }) {
    const cassette = JSON.parse(fs.readFileSync(cassettePath, 'utf8'));
    super({ model: `mock:${path.basename(cassettePath)}`, temperature: 0 });
    this.cassettePath = cassettePath;
    this.cassette = cassette;
    this.matchMode = matchMode;
    this.cursor = 0;
    this.drift = [];
  }

  describe() {
    return {
      ...super.describe(),
      cassette: path.basename(this.cassettePath),
      recordedModel: this.cassette.meta && this.cassette.meta.model,
      recordedAt: this.cassette.meta && this.cassette.meta.recordedAt,
      turns: this.cassette.turns.length,
      matchMode: this.matchMode,
    };
  }

  async preflight() {
    if (!Array.isArray(this.cassette.turns) || this.cassette.turns.length === 0) {
      throw new Error(`Cassette ${this.cassettePath} contains no turns.`);
    }
  }

  async generate({ system, prompt }) {
    return this._next({ system, toolDefs: [], contents: [{ role: 'user', parts: [{ text: prompt }] }] });
  }

  async generateWithTools({ system, toolDefs, contents }) {
    return this._next({ system, toolDefs, contents });
  }

  _next(request) {
    if (this.cursor >= this.cassette.turns.length) {
      throw new Error(
        `Cassette exhausted after ${this.cassette.turns.length} turns (${path.basename(this.cassettePath)}). ` +
          'The agent asked for more turns than were recorded — re-record the fixture.'
      );
    }
    const turn = this.cassette.turns[this.cursor++];
    const actual = hashRequest(request);

    if (turn.requestHash && turn.requestHash !== actual) {
      let detail =
        `Cassette drift at turn ${this.cursor}: recorded request ${turn.requestHash}, got ${actual}. ` +
        'The harness produced different observations than when this fixture was recorded.';

      // Localise the divergence so the cause is actionable.
      if (Array.isArray(turn.requestParts)) {
        const actualParts = hashParts(request.contents);
        const idx = firstDivergence(turn.requestParts, actualParts);
        if (idx === -1) {
          detail += ' Conversation entries all match — the difference is in the system prompt or tool schemas.';
        } else if (idx >= turn.requestParts.length || idx >= actualParts.length) {
          detail += ` Conversation length differs (recorded ${turn.requestParts.length} entries, got ${actualParts.length}).`;
        } else {
          detail +=
            ` First divergence at conversation entry ${idx} (${describeEntry(request.contents[idx])}): ` +
            `recorded ${turn.requestParts[idx]}, got ${actualParts[idx]}.`;
        }
      }

      if (this.matchMode === 'strict') throw new Error(detail);
      this.drift.push(detail);
    }
    return turn.response;
  }
}

/**
 * Wraps any provider and appends every turn to a cassette — this is how
 * fixtures are produced from a real run. Recording is a decorator so the agent
 * code path is byte-identical whether or not it is being recorded.
 */
class RecordingProvider extends LLMProvider {
  constructor({ inner, cassettePath, meta = {} }) {
    super({ model: inner.model, temperature: inner.temperature });
    // NB: the base constructor assigns this.onRetry, which hits the accessor
    // below before `inner` exists — hence the guarded setter and the replay here.
    this.inner = inner;
    if (this._onRetry) inner.onRetry = this._onRetry;
    this.cassettePath = cassettePath;
    this.turns = [];
    this.meta = meta;
    fs.mkdirSync(path.dirname(cassettePath), { recursive: true });
  }

  describe() {
    return { ...this.inner.describe(), recordingTo: path.basename(this.cassettePath) };
  }

  set onRetry(fn) {
    this._onRetry = fn;
    if (this.inner) this.inner.onRetry = fn;
  }
  get onRetry() {
    return this.inner ? this.inner.onRetry : this._onRetry;
  }

  async preflight() {
    return this.inner.preflight();
  }

  async generate(request) {
    return this._record(request, await this.inner.generate(request));
  }

  async generateWithTools(request) {
    return this._record(request, await this.inner.generateWithTools(request));
  }

  _record(request, response) {
    this.turns.push({
      requestHash: hashRequest(request),
      requestParts: hashParts(request.contents),
      response,
    });
    this.flush();
    return response;
  }

  flush() {
    fs.writeFileSync(
      this.cassettePath,
      JSON.stringify(
        {
          meta: {
            recordedAt: new Date().toISOString(),
            ...this.inner.describe(),
            ...this.meta,
          },
          turns: this.turns,
        },
        null,
        2
      )
    );
  }
}

module.exports = { MockProvider, RecordingProvider, hashRequest, hashParts, hashText, firstDivergence };
