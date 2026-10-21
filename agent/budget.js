/**
 * Budget — token/cost accounting and hard ceilings for a run.
 *
 * Two jobs:
 *  1. Measure. Per-step and per-run token counts, attributed to the bug session
 *     that spent them, so the benchmark can report cost per fix.
 *  2. Stop. A run that loops or degrades must abort cleanly rather than drain a
 *     quota — the free-tier exhaustion observed during early runs is exactly the
 *     failure this prevents.
 *
 * Dollar cost is reported only when the model is priced in pricing.json.
 * Otherwise cost is null with a reason; token counts are always real.
 */
const fs = require('fs');
const path = require('path');

class BudgetExceededError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'BudgetExceededError';
    this.detail = detail;
  }
}

function loadPricing(projectRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'agent', 'pricing.json'), 'utf8'));
  } catch {
    return { currency: 'USD', perMillionTokens: {} };
  }
}

/** The verified rate for a model, or null when pricing.json has none. */
function rateFor(pricing, model) {
  const entry = ((pricing && pricing.perMillionTokens) || {})[model];
  if (!entry || entry.input == null || entry.output == null) return null;
  return entry;
}

/**
 * USD cost of measured token counts at a per-million-token rate.
 *
 * Cached prompt tokens are a subset of input tokens (Gemini's promptTokenCount
 * includes cachedContentTokenCount, and the Gemini provider passes both through
 * unchanged). When the rate lists a cachedInput price, that subset is charged at
 * it instead of the full input price.
 */
function tokenCostUsd({ inputTokens = 0, outputTokens = 0, cacheReadTokens = 0 }, rate) {
  const cached = rate.cachedInput != null ? Math.min(cacheReadTokens, inputTokens) : 0;
  const usd =
    ((inputTokens - cached) / 1e6) * rate.input +
    (cached / 1e6) * (rate.cachedInput || 0) +
    (outputTokens / 1e6) * rate.output;
  return Number(usd.toFixed(6));
}

class Budget {
  /**
   * @param {object} opts
   * @param {number} [opts.maxTokens]     abort once total tokens exceed this
   * @param {number} [opts.maxCostUsd]    abort once estimated cost exceeds this (requires pricing)
   * @param {number} [opts.maxWallClockMs] abort once the run exceeds this duration
   * @param {number} [opts.maxApiCalls]   abort after this many provider calls
   */
  constructor({ projectRoot, model, maxTokens = null, maxCostUsd = null, maxWallClockMs = null, maxApiCalls = null } = {}) {
    this.startedAt = Date.now();
    this.model = model;
    this.limits = { maxTokens, maxCostUsd, maxWallClockMs, maxApiCalls };
    this.pricing = loadPricing(projectRoot || process.cwd());
    this.steps = [];
    this.totals = {
      apiCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    this.aborted = null;
  }

  get rate() {
    return rateFor(this.pricing, this.model);
  }

  get totalTokens() {
    return this.totals.inputTokens + this.totals.outputTokens;
  }

  /** Estimated cost, or null when the model has no verified price configured. */
  estimateCost() {
    const rate = this.rate;
    if (!rate) {
      return {
        usd: null,
        reason: `unpriced: no verified rate for "${this.model}" in agent/pricing.json`,
      };
    }
    return { usd: tokenCostUsd(this.totals, rate), reason: null, verifiedOn: rate.verifiedOn || null };
  }

  elapsedMs() {
    return Date.now() - this.startedAt;
  }

  /** Record one provider call. Returns the step record. */
  record(usage = {}, context = {}) {
    this.totals.apiCalls += 1;
    this.totals.inputTokens += usage.input_tokens || 0;
    this.totals.outputTokens += usage.output_tokens || 0;
    this.totals.cacheReadTokens += usage.cache_read_input_tokens || 0;
    this.totals.cacheWriteTokens += usage.cache_creation_input_tokens || 0;

    const step = {
      seq: this.totals.apiCalls,
      at: new Date().toISOString(),
      elapsedMs: this.elapsedMs(),
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cumulativeTokens: this.totalTokens,
      ...context,
    };
    this.steps.push(step);
    return step;
  }

  /**
   * Check every ceiling. Returns null when within budget, or a violation
   * describing which limit was hit — callers abort the run cleanly.
   */
  check() {
    const { maxTokens, maxCostUsd, maxWallClockMs, maxApiCalls } = this.limits;

    if (maxApiCalls != null && this.totals.apiCalls >= maxApiCalls) {
      return this._violation('api_calls', `${this.totals.apiCalls} provider calls >= limit ${maxApiCalls}`);
    }
    if (maxTokens != null && this.totalTokens >= maxTokens) {
      return this._violation('tokens', `${this.totalTokens} tokens >= limit ${maxTokens}`);
    }
    if (maxWallClockMs != null && this.elapsedMs() >= maxWallClockMs) {
      return this._violation(
        'wall_clock',
        `${Math.round(this.elapsedMs() / 1000)}s elapsed >= limit ${Math.round(maxWallClockMs / 1000)}s`
      );
    }
    if (maxCostUsd != null) {
      const cost = this.estimateCost();
      if (cost.usd != null && cost.usd >= maxCostUsd) {
        return this._violation('cost', `estimated $${cost.usd} >= limit $${maxCostUsd}`);
      }
    }
    return null;
  }

  _violation(limit, detail) {
    this.aborted = { limit, detail, at: new Date().toISOString() };
    return this.aborted;
  }

  /** Snapshot for the manifest / final report. */
  summary() {
    const cost = this.estimateCost();
    return {
      ...this.totals,
      totalTokens: this.totalTokens,
      elapsedMs: this.elapsedMs(),
      estimatedCostUsd: cost.usd,
      costNote: cost.reason,
      limits: this.limits,
      aborted: this.aborted,
    };
  }
}

module.exports = { Budget, BudgetExceededError, loadPricing, rateFor, tokenCostUsd };
