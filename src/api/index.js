'use strict';
/* Auto-loader: every module in this folder registers its own methods.
 * Add a file here and its API appears — index.js is never touched again.
 */

const fs = require('fs');
const path = require('path');

function loadApi(ctx) {
  const api = {};
  const files = fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.js') && f !== 'index.js')
    .sort();

  for (const file of files) {
    const mod = require(path.join(__dirname, file));
    const register = typeof mod === 'function' ? mod : (mod && mod.register);
    if (typeof register !== 'function') continue;
    const methods = register(ctx) || {};
    for (const [name, fn] of Object.entries(methods)) {
      if (typeof fn !== 'function') continue;
      if (api[name]) throw new Error(`orion-fca: duplicate api method "${name}" (from ${file})`);
      api[name] = fn;
    }
  }

  // discoverable surface for tooling / debugging
  api.methods = () => Object.keys(api).sort();
  return api;
}

module.exports = { loadApi };
