const path = require('path');
const { LLMProvider, EMPTY_USAGE } = require('./base');
const { GeminiProvider } = require('./gemini');
const { MockProvider, RecordingProvider, hashRequest } = require('./mock');

/**
 * Build the provider for a run.
 *
 * `provider: 'mock'` needs no credentials — that is the property that lets CI
 * exercise the full reasoning loop on a reviewer's fork with no secrets.
 */
function createProvider({
  provider = 'gemini',
  apiKey,
  model,
  temperature = 0,
  effort = 'high',
  cassettePath,
  record = false,
  matchMode = 'strict',
  meta = {},
} = {}) {
  if (provider === 'mock') {
    if (!cassettePath) throw new Error('provider "mock" requires cassettePath');
    return new MockProvider({ cassettePath, matchMode });
  }

  if (provider !== 'gemini') {
    throw new Error(`Unknown provider "${provider}". Supported: gemini, mock.`);
  }
  if (!apiKey) {
    throw new Error('provider "gemini" requires an API key (GEMINI_API_KEY).');
  }

  const inner = new GeminiProvider({ apiKey, model, temperature, effort });
  if (!record) return inner;

  return new RecordingProvider({
    inner,
    cassettePath: cassettePath || path.join('fixtures', `${model}-${Date.now()}.cassette.json`),
    meta,
  });
}

module.exports = {
  createProvider,
  LLMProvider,
  GeminiProvider,
  MockProvider,
  RecordingProvider,
  hashRequest,
  EMPTY_USAGE,
};
