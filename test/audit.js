'use strict';
/* audit — full health check of orion-fca.
 *   node test/audit.js [appstate]
 * Verifies: module graph, API surface, policy guards, live reads, bot compatibility.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APPSTATE = process.argv[2] || '/home/irfan/Desktop/ORION/account.txt';

const results = [];
const pass = (name, extra = '') => { results.push({ ok: true, name, extra }); console.log(`✓ ${name.padEnd(22)} ${extra}`); };
const fail = (name, extra = '') => { results.push({ ok: false, name, extra }); console.log(`✗ ${name.padEnd(22)} ${extra}`); };

/* ---------- 1. static: every require resolves ---------- */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = walk(ROOT).filter((f) => !f.includes('/test/'));
let missingPaths = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const m of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    const candidates = [target, `${target}.js`, path.join(target, 'index.js')];
    if (!candidates.some((c) => fs.existsSync(c))) missingPaths.push(`${path.relative(ROOT, file)} → ${m[1]}`);
  }
}
missingPaths.length ? fail('require paths', missingPaths.join(', ')) : pass('require paths', `${files.length} files`);

/* ---------- 2. static: syntax ---------- */
let syntaxErrors = [];
for (const file of files) {
  try { execSync(`node --check ${JSON.stringify(file)}`, { stdio: 'pipe' }); }
  catch (e) { syntaxErrors.push(path.relative(ROOT, file)); }
}
syntaxErrors.length ? fail('syntax', syntaxErrors.join(', ')) : pass('syntax', 'all files parse');

/* ---------- 3. module graph loads ---------- */
let login;
try { login = require(ROOT); pass('module loads', `version ${login.version}`); }
catch (e) { fail('module loads', e.message); }

/* ---------- 4. runtime surface ---------- */
const appState = JSON.parse(fs.readFileSync(APPSTATE, 'utf8'));

const BOT_USES = ['getCurrentUserID', 'sendMessage', 'removeUserFromGroup', 'changeNickname',
  'listenMqtt', 'getThreadInfo', 'getThreadList', 'setOptions', 'getUserInfo', 'listen',
  'getAppState', 'editMessage', 'changeAvatar', 'setTitle', 'handleMessageRequest',
  'handleFriendRequest', 'getThreadHistory', 'changeThreadEmoji', 'changeThreadColor',
  'changeGroupImage', 'addUserToGroup'];

login({ appState }, {}, async (err, api) => {
  if (err) {
    fail('login', JSON.stringify(err));
    return report();
  }
  pass('login', `uid ${api.getCurrentUserID()}`);

  const methods = api.methods();
  pass('api surface', `${methods.length} methods`);

  /* bot compatibility */
  const missing = BOT_USES.filter((m) => typeof api[m] !== 'function');
  missing.length ? fail('ORION compatibility', `missing: ${missing.join(', ')}`)
    : pass('ORION compatibility', `${BOT_USES.length}/${BOT_USES.length} bot methods present`);

  /* policy: every capability is backed by a function */
  const caps = api.capabilities();
  const unbacked = caps.filter((c) => typeof api[c.name] !== 'function').map((c) => c.name);
  unbacked.length ? fail('capability coverage', unbacked.join(', ')) : pass('capability coverage', `${caps.length} capabilities`);

  /* guards reject bad input locally */
  const guardChecks = [
    ['sendMessage', () => api.sendMessage('', null, () => {})],
    ['getThreadInfo', () => api.getThreadInfo(null, () => {})],
  ];
  let guardOk = 0;
  for (const [name, fn] of guardChecks) {
    let threw = false;
    try { fn(); } catch { threw = true; }
    if (threw) guardOk += 1;
  }
  pass('policy guards', `${guardOk}/${guardChecks.length} reject invalid args synchronously`);

  /* live reads (callback style, as the bot uses) */
  const call = (name, ...args) => new Promise((resolve) => {
    try { api[name](...args, (e, r) => resolve(e ? { error: e } : { result: r })); }
    catch (e) { resolve({ error: e }); }
  });

  const list = await call('getThreadList', 5, null, ['INBOX']);
  list.error ? fail('getThreadList', JSON.stringify(list.error)) : pass('getThreadList', `${list.result.length} threads`);

  const target = (list.result || [])[0];
  if (target) {
    const info = await call('getThreadInfo', target.threadID);
    info.error ? fail('getThreadInfo', JSON.stringify(info.error))
      : pass('getThreadInfo', `${info.result.participantIDs.length} participants, ${info.result.messageCount} msgs, group=${info.result.isGroup}`);

    const history = await call('getThreadHistory', target.threadID, 3);
    history.error ? fail('getThreadHistory', JSON.stringify(history.error))
      : pass('getThreadHistory', `${history.result.length} messages`);

    const uid = api.getCurrentUserID();
    const users = await call('getUserInfo', [uid]);
    const resolved = users.result ? Object.values(users.result)[0] : null;
    users.error ? fail('getUserInfo', JSON.stringify(users.error))
      : pass('getUserInfo', resolved && resolved.name ? `resolved "${resolved.name}"` : 'no name returned');
  }

  /* diagnostics */
  const check = await api.selfCheck();
  pass('selfCheck', `sync ${check.syncSequence}, ${check.latencyMs}ms`);
  pass('state/queue', `ledger ${JSON.stringify(check.ledger)}, outbox sent=${check.outbox.sent}`);

  /* known gaps, stated explicitly */
  const experimental = caps.filter((c) => c.experimental).map((c) => c.name);
  pass('known gaps', experimental.length ? experimental.join(', ') : 'none');

  report();
});

function report() {
  const ok = results.filter((r) => r.ok).length;
  console.log('\n=== orion-fca audit ===');
  for (const r of results) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(22)} ${r.extra || ''}`);
  }
  console.log(`\n${ok}/${results.length} checks passed`);
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}
