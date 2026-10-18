'use strict';
/* realtime — the incoming event stream. */

module.exports = (ctx) => {
  const { state } = ctx;

  const api = {
    listenMqtt(callback) {
      const cb = typeof callback === 'function' ? callback : () => {};
      const rt = ctx.realtime;

      // only the newest listener may deliver: re-attaching must not double
      // dispatch, and the previous handler must be detached or the emitter
      // grows without bound (GoatBot re-listens every hour)
      state.listenGen = (state.listenGen || 0) + 1;
      const gen = state.listenGen;

      if (state.listenHandler && typeof rt.off === 'function') rt.off(state.listenHandler);

      const handler = (event) => {
        if (gen !== state.listenGen) return;
        if (event.type === 'message' && event.messageID) ctx.ledger.putMessage(event);
        if (event.type === 'error' && String(event.error).includes('QUEUE_OVERFLOW')) return;
        cb(null, event);
      };

      rt.on(handler);
      state.listenHandler = handler;
      state.listening = true;

      // ctx.rt() connects once and opens the sync queue
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
