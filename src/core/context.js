'use strict';
/* Shared context — the only thing a domain module ever receives.
 *
 * Layers handed to a domain:
 *   client    the session (cookies, tokens, http)
 *   ledger    cached threads/messages, fed by queries and events
 *   outbox    every write: dedupe, rate limit, per-lane order, retry
 *   policy    local capability/argument checks before the wire
 */

const { Realtime } = require('../transport/realtime');
const { Ledger } = require('../state/ledger');
const { Outbox } = require('../queue/outbox');
const policy = require('../policy/capability');
const { nodeify } = require('../utils/callback');
const { threadList } = require('../queries/threads');
const { FcaError } = require('./errors');

function createContext(client, options = {}) {
  const realtime = new Realtime(client);
  const ledger = new Ledger(options.cache || {});
  const outbox = new Outbox(options.outbox || {});

  const state = { options, listening: false };
  let connecting = null;

  const ctx = {
    client,
    ledger,
    outbox,
    policy,
    realtime,
    state,
    nodeify,

    threadOf(messageID) { return ledger.threadOfMessage(messageID); },

    /** Validate a call before anything touches the network. */
    guard(name, args) {
      policy.check(name, args || [], { ledger });
    },

    /** Connect once and open the sync queue. */
    async rt() {
      if (connecting) return connecting;
      connecting = (async () => {
        if (!realtime.client) realtime.connect();
        if (!realtime.ready_) {
          const { seq } = await threadList(client, 1).catch(() => ({ seq: 0 }));
          await realtime.ready(seq);
        }
        return realtime;
      })();
      try { return await connecting; } finally { connecting = null; }
    },

    /** A single transport task, wrapped so failures are typed. */
    async task(spec) {
      const rt = await ctx.rt();
      try {
        return await rt.task(spec);
      } catch (e) {
        throw e instanceof FcaError ? e : new FcaError('TASK_FAILED', String(e && e.message ? e.message : e));
      }
    },

    /** A write: policy-checked, queued, deduped, retried. */
    write({ name, args, lane, key, run }) {
      ctx.guard(name, args);
      return outbox.submit({ lane: lane || 'default', key, run });
    },
  };

  return ctx;
}

module.exports = { createContext };
