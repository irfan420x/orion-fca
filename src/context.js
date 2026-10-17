'use strict';
/* Shared context handed to every api module. */

const { Transport } = require('./transport');

function createContext(session, options) {
  const state = {
    session,
    options: options || {},
    transport: null,
    threads: new Map(),   // threadID -> threadInfo
    msgThread: new Map(), // messageID -> threadID
    listening: false,
  };

  const ctx = {
    session,
    state,
    get userID() { return session.userID; },

    nodeify(promise, cb) {
      const done = typeof cb === 'function' ? cb : () => {};
      const p = promise && typeof promise.then === 'function' ? promise : Promise.resolve(promise);
      p.then((r) => done(null, r)).catch((e) => done(e && e.message ? e : { error: String(e && e.error ? e.error : e) }));
    },

    threadOf(messageID) { return state.msgThread.get(String(messageID)) || null; },

    async ensureTransport() {
      if (!state.transport) {
        state.transport = new Transport(session);
        state.transport.connect();
      }
      if (!state.transport._ready) {
        const { seq } = await session.threadList(1).catch(() => ({ seq: 0 }));
        await state.transport.ready(seq);
      }
      return state.transport;
    },

    /* Async task helper: ensures transport, publishes one /ls_req task. */
    async task(spec) {
      const t = await ctx.ensureTransport();
      return t.task(spec);
    },
  };

  return ctx;
}

module.exports = { createContext };
