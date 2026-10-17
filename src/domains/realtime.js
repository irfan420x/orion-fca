'use strict';
/* realtime — the incoming event stream. */

module.exports = (ctx) => {
  const { state } = ctx;

  const api = {
    listenMqtt(callback) {
      const cb = typeof callback === 'function' ? callback : () => {};
      const rt = ctx.realtime;

      rt.on((event) => {
        if (event.type === 'message' && event.messageID) ctx.ledger.putMessage(event);
        if (event.type === 'error' && String(event.error).includes('QUEUE_OVERFLOW')) return;
        cb(null, event);
      });

      state.listening = true;
      // ctx.rt() connects once and opens the sync queue; ready() alone assumes a client
      ctx.rt()
        .then(() => cb(null, { type: 'ready' }))
        .catch((e) => cb(e && e.toJSON ? e.toJSON() : { error: String(e && e.message ? e.message : e) }));

      return () => api.stopListening();
    },

    stopListening(callback) {
      state.listening = false;
      ctx.realtime.close();
      if (typeof callback === 'function') callback(null);
    },
  };

  api.listen = api.listenMqtt;
  return api;
};
