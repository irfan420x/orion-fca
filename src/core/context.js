'use strict';
/* Shared context — the only thing a domain module ever receives. */

const { Realtime } = require('../transport/realtime');
const { nodeify } = require('../utils/callback');
const { threadList } = require('../queries/threads');

function createContext(client, options = {}) {
  const realtime = new Realtime(client);
  const state = {
    options,
    threads: new Map(),   // threadID -> threadInfo
    msgThread: new Map(), // messageID -> threadID
    listening: false,
  };
  let connecting = null;

  const ctx = {
    client,
    state,
    realtime,
    nodeify,

    threadOf(messageID) {
      return state.msgThread.get(String(messageID)) || null;
    },

    /** Connect (once) and open the sync queue. */
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

    async task(spec) {
      const rt = await ctx.rt();
      return rt.task(spec);
    },
  };

  return ctx;
}

module.exports = { createContext };
