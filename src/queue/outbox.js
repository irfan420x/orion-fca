'use strict';
/* Outbox — every outbound mutation goes through here.
 *
 * Responsibilities that a bare `transport.task()` does not have:
 *   - dedupe: the same command fired twice inside the window resolves to one send
 *     (bots re-dispatch on reconnect; Facebook sees duplicates otherwise)
 *   - rate limit: a token bucket, so a burst of commands cannot trip FB's limiter
 *   - per-lane serialisation: two operations on the same thread run in order;
 *     different threads run in parallel
 *   - retry with exponential backoff on transport failures only (never on a
 *     Facebook validation error — repeating that is just noise)
 */

const { FcaError } = require('../core/errors');

const RETRYABLE = new Set(['ACK_TIMEOUT', 'MQTT_ERROR', 'NOT_CONNECTED', 'RATE_LIMITED']);

class Outbox {
  constructor({ ratePerSecond = 4, burst = 6, maxRetries = 1, baseDelayMs = 400, dedupeMs = 1500 } = {}) {
    this.ratePerSecond = ratePerSecond;
    this.capacity = burst;
    this.tokens = burst;
    this.refillAt = Date.now();
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
    this.dedupeMs = dedupeMs;
    this.lanes = new Map();    // lane -> tail promise
    this.recent = new Map();   // key -> { at, promise }
    this.counters = { queued: 0, sent: 0, deduped: 0, retried: 0, failed: 0 };
  }

  /* ---- public ------------------------------------------------------- */

  submit({ lane = 'default', key, run }) {
    const signature = key ? `${lane}:${key}` : null;

    if (signature) {
      const hit = this.recent.get(signature);
      if (hit && Date.now() - hit.at < this.dedupeMs) {
        this.counters.deduped += 1;
        return hit.promise;
      }
    }

    this.counters.queued += 1;
    const promise = this._enqueue(lane, run);
    if (signature) {
      this.recent.set(signature, { at: Date.now(), promise });
      setTimeout(() => this.recent.delete(signature), this.dedupeMs).unref?.();
    }
    return promise;
  }

  stats() { return { ...this.counters, lanes: this.lanes.size, tokens: Math.round(this.tokens) }; }

  /* ---- internals ---------------------------------------------------- */

  _enqueue(lane, run) {
    const tail = this.lanes.get(lane) || Promise.resolve();
    const next = tail
      .catch(() => {})                 // a failed op must not poison the lane
      .then(async () => {
        await this._take();
        return this._attempt(run);
      });

    this.lanes.set(lane, next);
    next.finally(() => { if (this.lanes.get(lane) === next) this.lanes.delete(lane); }).catch(() => {});
    return next;
  }

  async _attempt(run) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await run();
        this.counters.sent += 1;
        return result;
      } catch (error) {
        lastError = error;
        const code = error && error.code;
        const retryable = RETRYABLE.has(code) || (error && error.message && /timeout|ECONN|socket/i.test(error.message));
        if (!retryable || attempt === this.maxRetries) break;
        this.counters.retried += 1;
        const delay = this.baseDelayMs * (2 ** attempt) + Math.floor(Math.random() * 120);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    this.counters.failed += 1;
    throw lastError instanceof FcaError ? lastError : new FcaError('OUTBOX_FAILED', String(lastError && lastError.message ? lastError.message : lastError));
  }

  async _take() {
    for (;;) {
      const now = Date.now();
      const elapsed = (now - this.refillAt) / 1000;
      if (elapsed > 0) {
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.ratePerSecond);
        this.refillAt = now;
      }
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      const waitMs = Math.max(20, ((1 - this.tokens) / this.ratePerSecond) * 1000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

module.exports = { Outbox };
