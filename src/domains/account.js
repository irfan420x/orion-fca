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

    /** Photo id → a directly usable image URL (rank cards need this). */
    resolvePhotoUrl(photoID, callback) {
      return ctx.nodeify((async () => {
        const id = String(photoID || '');
        if (!id) throw new (require('../core/errors').FcaError)('BAD_PHOTO_ID', 'photoID is required');
        if (/^https?:\/\//i.test(id)) return id;
        // numeric ids are profile pictures — the graph endpoint always answers
        if (/^\d{6,}$/.test(id)) {
          return `https://graph.facebook.com/${id}/picture?width=720&height=720&type=large`;
        }
        try {
          const body = await client.http.get(`https://www.facebook.com/mercury/attachments/photo?photo_id=${encodeURIComponent(id)}`);
          const text = typeof body === 'string' ? body : JSON.stringify(body || '');
          const match = text.match(/https:\\\/\\\/[^"\\]+?\.(?:jpg|jpeg|png|webp)[^"\\]*/i);
          if (match) return match[0].replace(/\\\//g, '/');
        } catch { /* fall through */ }
        return `https://graph.facebook.com/${id}/picture?width=720&height=720`;
      })(), callback);
    },

    logout(callback) {
      return ctx.nodeify(Promise.reject(require('../core/errors').notImplemented('logout')), callback);
    },
  };

  api.setOptionsFca = api.setOptions;
  return api;
};
