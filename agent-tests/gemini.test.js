/**
 * Gemini backend internals that are testable without a network call:
 * schema translation, response normalisation, and retry policy.
 */
const { toFunctionDeclarations, normalize, withRetry } = require('../agent/providers/gemini');

describe('tool schema translation', () => {
  it('maps JSON schema types to the provider dialect', () => {
    const [decl] = toFunctionDeclarations([
      {
        name: 'read_file',
        description: 'read a file',
        input_schema: { type: 'object', properties: { path: { type: 'string', description: 'p' } }, required: ['path'] },
      },
    ]);

    expect(decl.name).toBe('read_file');
    expect(decl.parameters.type).toBe('OBJECT');
    expect(decl.parameters.properties.path.type).toBe('STRING');
    expect(decl.parameters.required).toEqual(['path']);
  });

  it('omits parameters entirely for a no-argument tool', () => {
    // The provider rejects an OBJECT schema with no properties.
    const [decl] = toFunctionDeclarations([{ name: 'run_tests', description: 'run', input_schema: { type: 'object', properties: {} } }]);
    expect(decl.parameters).toBeUndefined();
  });

  it('translates nested array item schemas', () => {
    const [decl] = toFunctionDeclarations([
      {
        name: 'record_hypotheses',
        description: 'record',
        input_schema: {
          type: 'object',
          properties: {
            hypotheses: {
              type: 'array',
              minItems: 2, // unsupported by the provider; must be dropped
              items: { type: 'object', properties: { id: { type: 'string' }, likelihood: { type: 'string', enum: ['high', 'low'] } } },
            },
          },
        },
      },
    ]);

    const items = decl.parameters.properties.hypotheses.items;
    expect(decl.parameters.properties.hypotheses.type).toBe('ARRAY');
    expect(decl.parameters.properties.hypotheses.minItems).toBeUndefined();
    expect(items.properties.likelihood.enum).toEqual(['high', 'low']);
  });
});

describe('response normalisation', () => {
  const response = {
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          role: 'model',
          parts: [
            { text: 'internal reasoning', thought: true },
            { text: 'visible narration' },
            { functionCall: { id: 'c1', name: 'read_file', args: { path: 'src/a.js' } } },
          ],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5, cachedContentTokenCount: 40 },
  };

  it('separates thoughts, narration and tool calls', () => {
    const out = normalize(response);
    expect(out.thoughts).toEqual(['internal reasoning']);
    expect(out.text).toBe('visible narration');
    expect(out.toolCalls).toEqual([{ id: 'c1', name: 'read_file', args: { path: 'src/a.js' } }]);
    expect(out.finishReason).toBe('STOP');
  });

  it('counts thinking tokens as output', () => {
    const out = normalize(response);
    expect(out.usage.input_tokens).toBe(100);
    expect(out.usage.output_tokens).toBe(25); // candidates + thoughts
    expect(out.usage.cache_read_input_tokens).toBe(40);
  });

  it('survives an empty response', () => {
    const out = normalize({});
    expect(out.toolCalls).toEqual([]);
    expect(out.usage.input_tokens).toBe(0);
    expect(out.raw).toBeNull();
  });
});

describe('retry policy', () => {
  // Backoff is real (seconds), so these exercise a single retry to stay fast.
  it('retries a transient failure and returns the eventual result', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 2) {
        const err = new Error('service unavailable');
        err.status = 503;
        throw err;
      }
      return 'ok';
    }, null, 5);

    expect(result).toBe('ok');
    expect(calls).toBe(2);
  }, 15000);

  it('does not retry a non-retriable error', async () => {
    let calls = 0;
    const err = new Error('bad request');
    err.status = 400;

    await expect(
      withRetry(async () => {
        calls += 1;
        throw err;
      }, null, 5)
    ).rejects.toThrow(/bad request/);
    expect(calls).toBe(1);
  });

  it('gives up immediately on a daily quota exhaustion', async () => {
    // Retrying a per-day cap only burns wall clock; it cannot succeed.
    let calls = 0;
    const err = new Error('Quota exceeded: GenerateRequestsPerDayPerProjectPerModel');
    err.status = 429;

    await expect(
      withRetry(async () => {
        calls += 1;
        throw err;
      }, null, 5)
    ).rejects.toThrow(/daily quota exhausted/i);
    expect(calls).toBe(1);
  });

  it('reports each retry to the callback', async () => {
    const messages = [];
    let calls = 0;
    await withRetry(async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('overloaded');
        err.status = 503;
        throw err;
      }
      return 'done';
    }, (m) => messages.push(m), 3);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/retrying/i);
  }, 15000);
});
