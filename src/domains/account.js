'use strict';
/* account — identity and session options. */

module.exports = (ctx) => {
  const { client, state } = ctx;

  const api = {
    getCurrentUserID: () => client.userID,
    getAppState: () => client.getAppState(),
    getCookies: () => client.getCookies(),

    setOptions(options) {
      state.options = { ...state.options, ...(options || {}) };
      client.setOptions(options);
      return api;
    },

    logout(callback) {
      ctx.nodeify(Promise.reject(require('../core/errors').notImplemented('logout')), callback);
    },
  };

  api.setOptionsFca = api.setOptions;
  return api;
};
