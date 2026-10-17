'use strict';
/* orion-fca — drop-in replacement surface for ORION (GoatBot v2).
 *
 *   const login = require('orion-fca');
 *   login({ appState }, options, (err, api) => { ... });
 *
 * Same call shape as the FCA ORION already uses, so only the require changes.
 */

const { Session } = require('./src/session');
const { Transport } = require('./src/transport');

const VERSION = '0.1.0';

function nodeify(promise, cb) {
  const done = typeof cb === 'function' ? cb : () => {};
  promise.then((r) => done(null, r)).catch((e) => done(e && e.message ? e : { error: String(e) }));
}

function buildApi(session) {
  const state = { transport: null, options: {}, threads: new Map(), msgThread: new Map(), listening: false };

  const api = {
    version: VERSION,

    /* ---- sync / identity -------------------------------------------- */
    getCurrentUserID: () => session.userID,
    getAppState: () => session.getAppState(),
    getCookies: () => session.getCookies(),
    setOptions(opts) { state.options = { ...(opts || {}) }; session.setOptions(state.options); return api; },
    setOptionsFca(opts) { return api.setOptions(opts); },

    /* ---- messaging --------------------------------------------------- */
    sendMessage(msg, threadID, callback, replyTo) {
      const text = typeof msg === 'string' ? msg : (msg && (msg.body || msg.text)) || '';
      nodeify(api._send(threadID, text, replyTo || (msg && msg.replyToMessage)), callback);
    },

    async _send(threadID, text, replyTo) {
      if (!state.transport || !state.transport.client) {
        state.transport = new Transport(session);
        state.transport.connect();
        const { seq } = await session.threadList(1).catch(() => ({ seq: 0 }));
        await state.transport.ready(seq);
      }
      return state.transport.send(threadID, text, replyTo);
    },

    editMessage() { throw { error: 'orion-fca: editMessage not implemented yet' }; },

    async _transport() {
      if (!state.transport) { state.transport = new Transport(session); state.transport.connect(); }
      if (!state.transport._ready) {
        const { seq } = await session.threadList(1).catch(() => ({ seq: 0 }));
        await state.transport.ready(seq);
      }
      return state.transport;
    },

    /* ---- threads / users --------------------------------------------- */
    getThreadList(limit, timestamp, tags, callback) {
      if (typeof tags === 'function') { callback = tags; }
      nodeify(session.threadList(Number(limit) || 20).then((r) => {
        r.threads.forEach((t) => state.threads.set(t.threadID, t));
        return r.threads;
      }), callback);
    },

    getThreadInfo(threadID, callback) {
      nodeify(session.threadInfo(threadID).then((info) => {
        state.threads.set(String(threadID), info);
        return info;
      }), callback);
    },

    getThreadHistory(threadID, amount, timestamp, callback) {
      nodeify(session.threadHistory(threadID, Number(amount) || 20, timestamp || null), callback);
    },

    getUserInfo(ids, callback) {
      nodeify(session.userInfo(ids), callback);
    },

    /* ---- realtime ----------------------------------------------------- */
    listenMqtt(callback) {
      const cb = typeof callback === 'function' ? callback : () => {};
      if (!state.transport) {
        state.transport = new Transport(session);
        state.transport.connect();
      }
      state.transport.on((ev) => {
        if (ev && ev.type === 'message' && ev.messageID) state.msgThread.set(ev.messageID, ev.threadID);
        if (process.env.ORION_FCA_DEBUG === '1') console.log('[orion-fca] event', JSON.stringify(ev).slice(0, 160));
        if (ev.type === 'error' && String(ev.error).includes('QUEUE_OVERFLOW')) return; // handled below
        cb(null, ev);
      });
      state.listening = true;
      session.threadList(1)
        .then((r) => state.transport.ready(r.seq))
        .then(() => cb(null, { type: 'ready' }))
        .catch((e) => cb(e && e.message ? e : { error: String(e) }));
      return () => api.stopListening();
    },

    stopListening(callback) {
      state.listening = false;
      if (state.transport) state.transport.close();
      state.transport = null;
      if (typeof callback === 'function') callback(null);
    },

    /* ---- raw escape hatch --------------------------------------------- */
    httpGet(url, cb) { nodeify(session.get(url), cb); },
    httpPost(url, form, cb) { nodeify(Promise.reject('orion-fca: httpPost not implemented yet'), cb); },
  };

  api.listen = api.listenMqtt;

  /* ---- thread administration (MQTT tasks) ---------------------------- */
  const T = (cb, promise) => nodeify(promise, cb);
  const threadOf = (messageID) => state.msgThread.get(String(messageID)) || null;

  api.addUserToGroup = (userIDs, threadID, cb) => T(cb, api._transport().then((t) => t.task({
    label: '23', version: '24502707779384158', queue: String(threadID),
    payload: { thread_key: String(threadID), contact_ids: [].concat(userIDs).map(String), sync_group: 1 },
  })));

  api.removeUserFromGroup = (userID, threadID, cb) => T(cb, api._transport().then((t) => t.task({
    label: '140', version: '25002366262773827', queue: 'remove_participant_v2',
    payload: { thread_id: String(threadID), contact_id: String(userID), sync_group: 1 },
  })));

  api.changeNickname = (nickname, threadID, participantID, cb) => T(cb, api._transport().then((t) => t.task({
    label: '44', queue: 'thread_participant_nickname',
    payload: { thread_key: String(threadID), contact_id: String(participantID), nickname: nickname || '', sync_group: 1 },
  })));

  api.setTitle = (title, threadID, cb) => T(cb, api._transport().then((t) => t.task({
    label: '32', queue: String(threadID),
    payload: { thread_key: String(threadID), thread_name: String(title), sync_group: 1 },
  })));

  api.changeAdminStatus = (threadID, ids, status, cb) => T(cb, api._transport().then((t) => Promise.all(
    [].concat(ids).map((id) => t.task({
      label: '25', queue: 'admin_status',
      payload: { thread_key: String(threadID), contact_id: String(id), is_admin: status ? 1 : 0 },
    })))));

  api.changeThreadEmoji = (emoji, threadID, cb) => T(cb, api._transport().then((t) => t.task({
    label: '100003', queue: 'thread_quick_reaction',
    payload: { thread_key: String(threadID), custom_emoji: String(emoji), avatar_sticker_instruction_key_id: null, sync_group: 1 },
  })));

  api.changeThreadColor = (color, threadID, cb) => T(cb, api._transport().then((t) => t.task({
    label: '43', queue: 'thread_theme',
    payload: { thread_key: String(threadID), theme_fbid: String(color), source: null, sync_group: 1, payload: null },
  })));

  api.changeGroupImage = (imageID, threadID, cb) => {
    if (typeof imageID !== 'string' || !/^\d+$/.test(imageID)) {
      return (typeof cb === 'function' ? cb : () => {})({ error: 'orion-fca: changeGroupImage needs an uploaded image id (upload not built yet)' });
    }
    T(cb, api._transport().then((t) => t.task({
      label: '37', queue: 'thread_image',
      payload: { thread_key: String(threadID), image_id: imageID, sync_group: 1 },
    })));
  };

  api.changeArchivedStatus = (threadID, archived, cb) => {
    const e = { error: 'orion-fca: changeArchivedStatus not mapped yet' };
    if (typeof cb === 'function') return cb(e);
    throw e;
  };

  api.changeAvatar = (image, cb) => {
    const e = { error: 'orion-fca: changeAvatar needs image upload (not built yet)' };
    if (typeof cb === 'function') return cb(e);
    throw e;
  };

  /* ---- message operations ------------------------------------------- */
  api.editMessage = (text, messageID, cb) => T(cb, api._transport().then((t) => t.task({
    label: '742', queue: threadOf(messageID) || 'edit_message',
    payload: { message_id: String(messageID), text: String(text) },
  })));

  api.addReaction = api.setMessageReaction = (reaction, messageID, cb, forceCustom) => T(cb,
    api._transport().then((t) => t.task({
      label: '29', queue: threadOf(messageID) || 'reaction',
      payload: {
        thread_key: threadOf(messageID) || '', timestamp_ms: Date.now(),
        message_id: String(messageID), reaction: String(reaction || ''),
        actor_id: session.userID, reaction_style: forceCustom ? 1 : null,
        sync_group: 1, send_attribution: 65537, dataclass_params: null,
      },
    })));

  api.unsendMessage = (messageID, cb) => T(cb, api._transport().then((t) => t.task({
    label: '33', queue: 'unsend_message',
    payload: { message_id: String(messageID), thread_key: threadOf(messageID) || '', sync_group: 1 },
  })));

  api.deleteMessage = api.deleteThread = (threadID, cb) => T(cb, api._transport().then((t) => t.task({
    label: '146', queue: String(threadID),
    payload: { thread_key: String(threadID), remove_type: 0, sync_group: 1 },
  })));

  api.markAsRead = (threadID, cb) => T(cb, api._transport().then((t) => t.task({
    label: '21', queue: String(threadID),
    payload: { thread_id: String(threadID), last_read_watermark_ts: Date.now(), sync_group: 1 },
  })));

  api.markAsSeen = api.markAsRead;
  api.markAsDelivered = (threadID, cb) => (typeof cb === 'function' ? cb(null) : undefined);

  /* not mapped to a transport yet — explicit, not silent */
  api.handleMessageRequest = (threadID, accept, cb) => {
    const e = { error: 'orion-fca: handleMessageRequest not mapped yet' };
    if (typeof cb === 'function') return cb(e);
    throw e;
  };
  api.handleFriendRequest = (userID, accept, cb) => {
    const e = { error: 'orion-fca: handleFriendRequest not mapped yet' };
    if (typeof cb === 'function') return cb(e);
    throw e;
  };

  api.httpPost = (url, form, cb) => T(cb, (async () => {
    const body = new URLSearchParams(form && form.form ? form.form : form || {});
    const r = await fetch(url.startsWith('http') ? url : `https://www.facebook.com${url}`, {
      method: 'POST',
      headers: { 'user-agent': 'Mozilla/5.0', cookie: session.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    return { status: r.status, body: await r.text() };
  })());

  api.logout = (cb) => { api.stopListening(); if (typeof cb === 'function') cb({ error: 'orion-fca: logout not mapped yet' }); };

  return api;
}

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
    .then(() => cb(null, buildApi(session)))
    .catch((e) => cb(e && e.message ? e : { error: String(e) }));
}

module.exports = login;
module.exports.default = login;
module.exports.login = login;
module.exports.version = VERSION;
