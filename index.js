'use strict';
/* orion-fca — drop-in replacement for ORION (GoatBot v2).
 *
 *   const login = require('orion-fca');
 *   login({ appState }, options, (err, api) => { ... });
 *
 * This file only wires things together:
 *   session   → the Facebook HTTP/GraphQL side
 *   context   → shared state handed to every api module
 *   src/api/* → the actual methods, auto-loaded (add a file = add an API)
 */

const { Session } = require('./src/session');
const { createContext } = require('./src/context');
const { loadApi } = require('./src/api');

const VERSION = '0.2.0';

function login(credentials, options, callback) {
  let cb = callback;
  let opts = options;
  if (typeof options === 'function') { cb = options; opts = {}; }
  cb = typeof cb === 'function' ? cb : () => {};

  const appState = credentials && (credentials.appState || credentials);
  if (!appState) return cb({ error: 'appState is required' });

  const session = new Session(appState);
  session.setOptions(opts);

  session.login()
    .then(() => {
      const ctx = createContext(session, opts);
      const api = loadApi(ctx);
      api.version = VERSION;
      cb(null, api);
    })
    .catch((e) => cb(e && e.message ? e : { error: String(e) }));
}

module.exports = login;
module.exports.default = login;
module.exports.login = login;
module.exports.version = VERSION;
