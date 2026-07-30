/**
 * Gemini backend: function calling + thinking, behind the LLMProvider interface.
 * Converts the agent's JSON-schema tool definitions to Gemini
 * functionDeclarations, normalises responses/usage, and retries transient
 * errors with exponential backoff and jitter.
 */
const { GoogleGenAI } = require('@google/genai');
const { LLMProvider } = require('./base');

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

async function withRetry(fn, onRetry, maxAttempts = 8) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
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
      if (onRetry) onRetry(`Gemini error ${status || ''} — retrying in ${Math.round(delayMs / 1000)}s (attempt ${i + 1}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/** Normalise a Gemini candidate into the provider-neutral response shape. */
function normalize(response) {
  const candidate = (response.candidates && response.candidates[0]) || null;
  const parts = (candidate && candidate.content && candidate.content.parts) || [];
  const u = response.usageMetadata || {};

  const thoughts = [];
  const textChunks = [];
  const toolCalls = [];
  for (const p of parts) {
    if (p.functionCall) {
      toolCalls.push({ id: p.functionCall.id, name: p.functionCall.name, args: p.functionCall.args || {} });
    } else if (p.thought && p.text) {
      thoughts.push(p.text);
    } else if (p.text) {
      textChunks.push(p.text);
    }
  }

  return {
    text: textChunks.join('\n'),
    thoughts,
    toolCalls,
    raw: candidate ? candidate.content : null,
    finishReason: candidate ? candidate.finishReason : null,
    usage: {
      input_tokens: u.promptTokenCount || 0,
      output_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
      cache_read_input_tokens: u.cachedContentTokenCount || 0,
      cache_creation_input_tokens: 0,
    },
  };
}

class GeminiProvider extends LLMProvider {
  constructor({ apiKey, model, temperature = 0, effort = 'high', maxOutputTokens = 16384 }) {
    super({ model, temperature });
    this.ai = new GoogleGenAI({ apiKey });
    this.effort = effort;
    this.maxOutputTokens = maxOutputTokens;
    // Map the CLI's effort knob to a Gemini thinking budget (-1 = dynamic).
    this.thinkingBudget = { low: 1024, medium: 4096, high: -1, xhigh: 32768, max: 32768 }[effort] ?? -1;
  }

  describe() {
    return { ...super.describe(), effort: this.effort, thinkingBudget: this.thinkingBudget, maxOutputTokens: this.maxOutputTokens };
  }

  async preflight() {
    await withRetry(
      () =>
        this.ai.models.generateContent({
          model: this.model,
          contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }],
          config: { maxOutputTokens: 1500, temperature: this.temperature },
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

  /** Resolve the concrete model version behind an alias, for the run manifest. */
  async resolveModelVersion() {
    try {
      const info = await this.ai.models.get({ model: this.model });
      return { name: info.name, version: info.version || null, displayName: info.displayName || null };
    } catch (e) {
      return { name: this.model, version: null, resolutionError: e.message };
    }
  }

  async generate({ system, prompt }) {
    const response = await withRetry(
      () =>
        this.ai.models.generateContent({
          model: this.model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            systemInstruction: system,
            temperature: this.temperature,
            maxOutputTokens: this.maxOutputTokens,
          },
        }),
      this.onRetry
    );
    return normalize(response);
  }

  async generateWithTools({ system, toolDefs, contents }) {
    const response = await withRetry(
      () =>
        this.ai.models.generateContent({
          model: this.model,
          contents,
          config: {
            systemInstruction: system,
            temperature: this.temperature,
            tools: [{ functionDeclarations: toFunctionDeclarations(toolDefs) }],
            thinkingConfig: { includeThoughts: true, thinkingBudget: this.thinkingBudget },
            maxOutputTokens: this.maxOutputTokens,
          },
        }),
      this.onRetry
    );
    return normalize(response);
  }
}

module.exports = { GeminiProvider, toFunctionDeclarations, normalize, withRetry };
