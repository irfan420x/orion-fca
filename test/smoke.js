'use strict';
/* smoke — exercise orion-fca exactly the way ORION does. */
const fs = require('fs');
const login = require('../');

const APPSTATE = process.env.APPSTATE || '/home/irfan/Desktop/ORION/account.txt';
const appState = JSON.parse(fs.readFileSync(APPSTATE, 'utf8'));

login({ appState }, { listenEvents: true, selfListen: false }, (err, api) => {
  if (err) { console.error('LOGIN FAILED', err); process.exit(1); }
  console.log('login ✓ uid =', api.getCurrentUserID());
  console.log('appstate cookies =', api.getAppState().length, '| version', api.version);

  api.getThreadList(5, null, ['INBOX'], (e, list) => {
    if (e) { console.error('threadList failed', e); process.exit(1); }
    console.log(`getThreadList ✓ ${list.length}`);
    list.slice(0, 3).forEach((t) => console.log(`  · ${t.threadID} | ${t.snippet.slice(0, 48)} | unread ${t.unreadCount}`));

    const target = list.find((t) => t.threadID === process.env.THREAD_ID) || list[0];
    console.log('sendMessage →', target.threadID);
    api.sendMessage({ body: `orion-fca smoke ✓ v${api.version}` }, target.threadID, (se, res) => {
      if (se) { console.error('send failed', se); process.exit(1); }
      console.log('sendMessage ✓', res.messageID);

      const stop = api.listenMqtt((le, ev) => {
        if (le) { console.error('listen error', le); return; }
        console.log('listen event:', ev.type);
        if (ev.type === 'ready') setTimeout(() => { stop(); console.log('done'); process.exit(0); }, 6000);
      });
    });
  });
});

setTimeout(() => { console.log('timeout'); process.exit(1); }, 60000);
