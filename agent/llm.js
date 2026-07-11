/**
 * Gemini API client wrapper (function calling + thinking) for the debugging agent.
 * Converts the agent's JSON-schema tool definitions to Gemini functionDeclarations
 * and normalizes responses/usage. Retries transient errors with backoff.
 */
const { GoogleGenAI } = require('@google/genai');

const TYPE_MAP = {
  object: 'OBJECT',
  string: 'STRING',
  array: 'ARRAY',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
};

/** Convert a JSON-schema subset to Gemini's OpenAPI-style schema (drops unsupported keys like minItems). */
function convertSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  if (schema.type) out.type = TYPE_MAP[schema.type] || schema.type;
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.required) out.required = schema.required;
  if (schema.items) out.items = convertSchema(schema.items);
  if (schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) out.properties[k] = convertSchema(v);
  }
  // Gemini rejects OBJECT schemas with no properties (e.g. run_tests takes no args).
  if (out.type === 'OBJECT' && (!out.properties || Object.keys(out.properties).length === 0)) {
    delete out.properties;
    delete out.required;
  }
  return out;
}

function toFunctionDeclarations(toolDefs) {
  return toolDefs.map((t) => {
    const decl = { name: t.name, description: t.description };
    const params = convertSchema(t.input_schema);
    if (params && params.properties) decl.parameters = params;
    return decl;
  });
}

function isDailyQuotaError(e) {
  return /PerDay|per day|daily/i.test(String(e.message || ''));
}

async function withRetry(fn, onRetry) {
  let lastErr;
  for (let i = 0; i < 8; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e.status ?? e.code;
      const retriable =
        status === 429 || status === 500 || status === 503 ||
        /overloaded|quota|unavailable|resource.?exhausted|deadline|fetch failed|ECONNRESET/i.test(String(e.message || ''));
      if (!retriable) throw e;
      if (status === 429 && isDailyQuotaError(e)) {
        throw new Error(`Gemini daily quota exhausted — retrying is pointless. (${e.message})`);
      }
      let delayMs = Math.min(60000, 1500 * 2 ** i) + Math.random() * 1000;
      const m = String(e.message).match(/retry.?delay[^0-9]*([0-9.]+)\s*s/i);
      if (m) delayMs = Math.max(delayMs, parseFloat(m[1]) * 1000 + 500);
      if (onRetry) onRetry(`Gemini error ${status || ''} — retrying in ${Math.round(delayMs / 1000)}s (attempt ${i + 1}/8)`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

class GeminiClient {
  constructor({ apiKey, model, effort = 'high' }) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
    // Map the CLI's effort knob to a Gemini thinking budget (-1 = dynamic).
    this.thinkingBudget = { low: 1024, medium: 4096, high: -1, xhigh: 32768, max: 32768 }[effort] ?? -1;
    this.onRetry = null;
  }

  /** Cheap pre-flight to fail fast on bad keys/model ids before a long run. */
  async preflight() {
    await withRetry(
      () =>
        this.ai.models.generateContent({
          model: this.model,
          contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }],
          config: { maxOutputTokens: 1500 },
        }),
      this.onRetry
    );
  }

  async listModels() {
    const names = [];
    const pager = await this.ai.models.list();
    for await (const m of pager) {
      if (m.name) names.push(m.name.replace(/^models\//, ''));
    }
    return names;
  }

  /**
   * One conversation turn.
   * @returns {candidate, usage} — candidate.content.parts may contain
   *   {text}, {text, thought:true}, and {functionCall:{name,args,id?}} parts.
   */
  async chat({ system, toolDefs, contents }) {
    const response = await withRetry(
      () =>
        this.ai.models.generateContent({
          model: this.model,
          contents,
          config: {
            systemInstruction: system,
            tools: [{ functionDeclarations: toFunctionDeclarations(toolDefs) }],
            thinkingConfig: { includeThoughts: true, thinkingBudget: this.thinkingBudget },
            maxOutputTokens: 16384,
          },
        }),
      this.onRetry
    );

    const candidate = response.candidates && response.candidates[0];
    const u = response.usageMetadata || {};
    return {
      candidate,
      usage: {
        input_tokens: u.promptTokenCount || 0,
        output_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
        cache_read_input_tokens: u.cachedContentTokenCount || 0,
        cache_creation_input_tokens: 0,
      },
    };
  }
}

module.exports = { GeminiClient, toFunctionDeclarations };
