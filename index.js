'use strict';
/* orion-fca — drop-in replacement for ORION (GoatBot v2).
 *
 *   const login = require('orion-fca');
 *   login({ appState }, options, (err, api) => { ... });
 *
 * Structure:
 *   src/core        client (session) + context (shared state) + errors
 *   src/protocol    endpoint registry: doc ids, task labels, topics
 *   src/transport   http (Relay), realtime (MQTT), requests (envelopes)
 *   src/queries     read shapes (threads, users)
 *   src/domains     the public api, auto-loaded — one file per domain
 *   src/utils       callbacks and delta normalization
 */

const { Client } = require('./src/core/client');
const { createContext } = require('./src/core/context');
const { loadApi } = require('./src/api/loader');

const VERSION = require('./package.json').version;

function login(credentials, options, callback) {
  let cb = callback;
  let opts = options;
  if (typeof options === 'function') { cb = options; opts = {}; }
  cb = typeof cb === 'function' ? cb : () => {};

  const appState = credentials && (credentials.appState || credentials);
  if (!appState) return cb({ error: 'appState is required' });

  const client = new Client(appState, opts || {});

  client.login()
    .then(() => {
      const api = loadApi(createContext(client, opts || {}));
      api.version = VERSION;
      cb(null, api);
    })
    .catch((e) => cb(e && e.toJSON ? e.toJSON() : { error: String(e && e.message ? e.message : e) }));
}

module.exports = login;
module.exports.default = login;
module.exports.login = login;
module.exports.version = VERSION;
