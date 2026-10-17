# orion-fca

An independent Facebook Messenger client — **no third-party FCA code**. It talks to
Facebook's own HTTP/GraphQL and MQTT endpoints directly, with a drop-in API surface
so an existing bot only changes its `require` line.

```js
const login = require('orion-fca');

login({ appState }, { listenEvents: true }, (err, api) => {
  if (err) throw err;

  api.listenMqtt((err, event) => {
    if (event.type === 'message' && event.body === '.ping') {
      api.sendMessage('pong', event.threadID);
    }
  });
});
```

## Why

Every popular `fca-unofficial` fork is a branch of the same 2020-era codebase, and
they break whenever Facebook rotates a `doc_id`. This client is written against the
observed protocol instead: a small, documented surface that can be re-probed and
repaired in one place.

## What works

| Area | Methods |
|---|---|
| Identity | `getCurrentUserID` `getAppState` `getCookies` `setOptions` |
| Reading | `getThreadList` `getThreadInfo` `getThreadHistory` `getUserInfo` |
| Sending | `sendMessage` |
| Editing | `editMessage` `unsendMessage` `deleteMessage` `addReaction` |
| Reading state | `markAsRead` `markAsSeen` |
| Groups | `addUserToGroup` `removeUserFromGroup` `changeNickname` `setTitle` `changeAdminStatus` `changeThreadEmoji` `changeThreadColor` `changeGroupImage` |
| Realtime | `listenMqtt` `listen` `stopListening` |
| Raw | `httpGet` `httpPost` |

Not mapped yet: `changeAvatar`, `changeArchivedStatus`, `handleMessageRequest`,
`handleFriendRequest`, `logout`.

## Project layout

```
index.js                 login() only — wiring, nothing else
src/
  core/
    client.js            session: cookies, identity, tokens
    context.js           shared state handed to every domain
    errors.js            typed errors (FcaError, FB code map)
  protocol/
    endpoints.js         doc ids, task labels, task versions
    topics.js            realtime topic list
  transport/
    http.js              browser-faithful Relay GET/POST + token bootstrap
    realtime.js          MQTT over WebSocket: send, tasks, delta stream
    requests.js          /ls_req envelope builder + ack parsing
  queries/
    threads.js           thread list / info / history shapes
    users.js             profile shapes
  domains/               ← the public api, auto-loaded one file per area
    account.js  messages.js  threads.js  groups.js  users.js
    realtime.js  net.js
  utils/
    callback.js          node-style callback adapter
    normalize.js         wire delta → public event
  api/loader.js          scans src/domains, merges, fails on duplicates
test/smoke.js            login → threads → send → listen
```

**Adding an API never touches `index.js`.** Drop `src/domains/<name>.js`
exporting `(ctx) => ({ methodName(...) {...} })`; the loader merges it, and a
duplicate name throws `DUPLICATE_API` instead of silently shadowing.
`api.methods()` lists the result at runtime.

## How it works

1. **Session** — the appstate cookies are sent with a complete desktop-Chrome header
   set. Partial headers get HTTP 400; the `sec-ch-ua*`/`sec-fetch-*` set is the gate.
2. **Tokens** — `fb_dtsg`, `lsd`, `__spin_r`, `hsi` are bootstrapped from
   `facebook.com/messages/t/`. Tokens from messenger.com are rejected (`1357004`).
3. **Reading** — Relay GraphQL at `/api/graphql/` and `/api/graphqlbatch/`.
   `includeSeqID: true` is required or the sync queue starts at 0 and overflows.
4. **Realtime** — MQTT over WebSocket to `edge-chat.facebook.com`, with a custom
   `Duplex` adapter (Facebook sends no subprotocol and a non-standard PUBACK, so
   publishes use QoS 0 and acknowledgements are read from `/ls_resp`).
5. **Writing** — `/ls_req` tasks with a numeric `label` per operation
   (`46` send, `29` reaction, `33` unsend, `44` nickname, `32` title,
   `23` add user, `140` remove user, `25` admin, `100003` emoji, `43` theme).

## Session data

The appstate is a Facebook session cookie set — treat it like a password. It is
never logged and the repo's `.gitignore` excludes `account.txt` / `appstate.json`.

## Status

Early. Read and send paths are verified end-to-end against a live account; group
and message mutations are mapped and exercised, with the remaining five listed above.

## License

MIT
