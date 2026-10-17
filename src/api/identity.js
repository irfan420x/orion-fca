'use strict';
/* identity — who we are and how the session is configured. */

module.exports = function register(ctx) {
  const { session, state } = ctx;

  const api = {
    getCurrentUserID: () => session.userID,
    getAppState: () => session.getAppState(),
    getCookies: () => session.getCookies(),

    setOptions(opts) {
      state.options = { ...(opts || {}) };
      session.setOptions(state.options);
      return api;
    },
    setOptionsFca(opts) {
      state.options = { ...(opts || {}) };
      session.setOptions(state.options);
      return api;
    },

    logout(callback) {
      ctx.nodeify(Promise.reject('logout is not mapped to a Facebook endpoint yet'), callback);
    },
  };

  return api;
};
