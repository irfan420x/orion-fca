'use strict';
/* Typed error surface — every failure has a code, never a bare string. */

class FcaError extends Error {
  constructor(code, message, meta = {}) {
    super(message || code);
    this.name = 'FcaError';
    this.code = code;
    this.meta = meta;
  }
  toJSON() { return { error: this.message, code: this.code, ...this.meta }; }
}

/** Wraps a Facebook numeric error (e.g. 1357004) with a readable code. */
function fromFacebook(error, summary) {
  const codes = {
    1357001: 'NOT_LOGGED_IN',
    1357004: 'SESSION_CONTEXT_INVALID',
    1545012: 'RATE_LIMITED',
  };
  const code = codes[error] || `FB_${error}`;
  const messages = {
    NOT_LOGGED_IN: 'Facebook rejected the session — re-export the appstate.',
    SESSION_CONTEXT_INVALID: 'Facebook rejected the request context (tokens are per-surface).',
    RATE_LIMITED: 'Facebook is rate limiting this session — back off and retry.',
  };
  return new FcaError(code, messages[code] || summary || `Facebook error ${error}`, { fbError: error });
}

const notImplemented = (what) =>
  new FcaError('NOT_IMPLEMENTED', `${what} is not mapped to a Facebook endpoint yet`);

module.exports = { FcaError, fromFacebook, notImplemented };
