'use strict';
/* net — raw escape hatches for anything not modelled yet. */

module.exports = function register(ctx) {
  const { session } = ctx;

  return {
    httpGet(url, callback) {
      ctx.nodeify(session.get(url), callback);
    },

    httpPost(url, form, callback) {
      ctx.nodeify((async () => {
        const body = new URLSearchParams((form && form.form) || form || {});
        const target = /^https?:\/\//.test(url) ? url : `https://www.facebook.com${url}`;
        const r = await fetch(target, {
          method: 'POST',
          headers: {
            'user-agent': 'Mozilla/5.0',
            cookie: session.cookie,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body,
        });
        return { status: r.status, body: await r.text() };
      })(), callback);
    },
  };
};
