'use strict';
/* realtime — the incoming event stream. */

const { Transport } = require('../transport');

module.exports = function register(ctx) {
  const { session, state } = ctx;

  const api = {
    listenMqtt(callback) {
      const cb = typeof callback === 'function' ? callback : () => {};

      if (!state.transport) {
        state.transport = new Transport(session);
        state.transport.connect();
      }

      state.transport.on((ev) => {
        if (!ev) return;
        if (ev.type === 'message' && ev.messageID) state.msgThread.set(ev.messageID, ev.threadID);
        if (ev.type === 'error' && String(ev.error).includes('QUEUE_OVERFLOW')) return;
        cb(null, ev);
      });

      state.listening = true;
      session.threadList(1)
        .then((r) => state.transport.ready(r.seq))
        .then(() => cb(null, { type: 'ready' }))
        .catch((e) => cb(e && e.message ? e : { error: String(e) }));

      return () => api.stopListening();
    },

    stopListening(callback) {
      state.listening = false;
      if (state.transport) state.transport.close();
      state.transport = null;
      if (typeof callback === 'function') callback(null);
    },
  };

  api.listen = api.listenMqtt;
  return api;
};
