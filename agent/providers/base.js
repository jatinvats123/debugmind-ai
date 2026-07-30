/**
 * LLMProvider — the interface every backend implements.
 *
 * The agent talks only to this interface, which is what allows the entire
 * reasoning loop to be exercised offline (and in CI, with no API key) by
 * swapping GeminiProvider for MockProvider.
 *
 * Normalised response shape returned by both methods:
 *   {
 *     text:          string,                 // concatenated non-thought text
 *     thoughts:      string[],               // reasoning summaries, if exposed
 *     toolCalls:     [{ id?, name, args }],  // provider-neutral tool calls
 *     raw:           object,                 // provider-native turn, replayed verbatim
 *     finishReason:  string|null,
 *     usage:         { input_tokens, output_tokens, cache_read_input_tokens,
 *                     cache_creation_input_tokens },
 *   }
 */
class LLMProvider {
  constructor({ model, temperature = 0 }) {
    this.model = model;
    this.temperature = temperature;
    this.onRetry = null;
  }

  /** Human-readable identity of the backend, recorded in the run manifest. */
  describe() {
    return { provider: this.constructor.name, model: this.model, temperature: this.temperature };
  }

  /** Cheap call to fail fast on bad credentials/model ids before a long run. */
  async preflight() {
    throw new Error(`${this.constructor.name} must implement preflight()`);
  }

  /** Single-shot text generation, no tools. */
  // eslint-disable-next-line no-unused-vars
  async generate({ system, prompt }) {
    throw new Error(`${this.constructor.name} must implement generate()`);
  }

  /** One turn of a tool-calling conversation. */
  // eslint-disable-next-line no-unused-vars
  async generateWithTools({ system, toolDefs, contents }) {
    throw new Error(`${this.constructor.name} must implement generateWithTools()`);
  }
}

const EMPTY_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

module.exports = { LLMProvider, EMPTY_USAGE };
