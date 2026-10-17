'use strict';
/* Auto-loader — every module in src/domains registers its own methods.
 * Add a file there and its API appears; index.js is never touched again.
 */

const fs = require('fs');
const path = require('path');
const { FcaError } = require('../core/errors');

const DOMAINS = path.join(__dirname, '..', 'domains');

function loadApi(ctx) {
  const api = {};
  const files = fs.readdirSync(DOMAINS).filter((f) => f.endsWith('.js')).sort();

  for (const file of files) {
    const register = require(path.join(DOMAINS, file));
    if (typeof register !== 'function') continue;
    const methods = register(ctx) || {};
    for (const [name, fn] of Object.entries(methods)) {
      if (typeof fn !== 'function') continue;
      if (api[name]) throw new FcaError('DUPLICATE_API', `"${name}" is registered twice (see ${file})`);
      api[name] = fn;
    }
  }

  api.methods = () => Object.keys(api).filter((k) => typeof api[k] === 'function').sort();
  return api;
}

module.exports = { loadApi };
