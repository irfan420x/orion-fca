'use strict';
/* Callback adapter — every public method answers in node style. */

function nodeify(promise, callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  const p = promise && typeof promise.then === 'function' ? promise : Promise.resolve(promise);
  p.then((result) => done(null, result))
    .catch((e) => done(e && e.toJSON ? e.toJSON() : (e && e.message ? { error: e.message } : { error: String(e && e.error ? e.error : e) })));
  return p.catch(() => {});
}

module.exports = { nodeify };
