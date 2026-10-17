'use strict';
/* orion-fca — session: appstate, token bootstrap, Relay GraphQL. */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'cache-control': 'max-age=0',
};

const DOC = {
  threads: '3336396659757871',
  threadInfo: null,
  history: null,
  userInfo: null,
};

const jazoest = (s) => '2' + [...s].reduce((n, c) => n + c.charCodeAt(0), 0);
const pick = (html, res) => { for (const re of res) { const m = html.match(re); if (m) return m[1]; } return null; };

class Session {
  constructor(appState) {
    this.state = Array.isArray(appState) ? appState : JSON.parse(appState);
    this.cookie = this.state.map((c) => `${c.key}=${c.value}`).join('; ');
    this.jar = Object.fromEntries(this.state.map((c) => [c.key, c.value]));
    this.userID = this.jar.c_user;
    this.tk = null;
    this.options = {};
  }

  setOptions(opts) { this.options = { ...(opts || {}) }; return this; }

  async get(url) {
    const r = await fetch(url, { headers: { ...HEADERS, cookie: this.cookie }, redirect: 'follow' });
    return { status: r.status, url: r.url, text: await r.text() };
  }

  async login() {
    if (!this.userID || !this.jar.xs) throw new Error('appState is missing c_user/xs');
    const page = await this.get('https://www.facebook.com/messages/t/');
    const h = page.text;
    this.tk = {
      dtsg: pick(h, [/"DTSGInitData"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/, /"fb_dtsg"\s*:\s*"([^"]+)"/]),
      lsd: pick(h, [/"LSD"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/, /"lsd"\s*:\s*"([^"]+)"/]),
      rev: pick(h, [/"__spin_r"\s*:\s*(\d+)/]) || '0',
      hsi: pick(h, [/"hsi"\s*:\s*"(\d+)"/]) || '0',
      hs: pick(h, [/"__hs"\s*:\s*"([^"]+)"/]) || '',
    };
    if (!this.tk.dtsg) throw new Error(`login failed: no fb_dtsg (HTTP ${page.status})`);
    return this;
  }

  async graphql(docId, params, name = 'query') {
    if (!this.tk) await this.login();
    const form = new URLSearchParams({
      av: this.userID, __user: this.userID, __a: '1', __req: '1', __hs: this.tk.hs,
      __ccg: 'EXCELLENT', __rev: this.tk.rev, __hsi: this.tk.hsi, __comet_req: '15',
      lsd: this.tk.lsd, jazoest: jazoest(this.tk.dtsg), fb_dtsg: this.tk.dtsg,
      __spin_r: this.tk.rev, __spin_b: 'trunk', __spin_t: String(Math.floor(Date.now() / 1000)),
      doc_id: docId, variables: JSON.stringify(params),
    });
    const r = await fetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      headers: {
        ...HEADERS, cookie: this.cookie, accept: '*/*',
        'content-type': 'application/x-www-form-urlencoded',
        'x-requested-with': 'XMLHttpRequest', 'x-fb-lsd': this.tk.lsd, 'x-asbd-id': '129477',
        'x-fb-friendly-name': name,
        origin: 'https://www.facebook.com', referer: 'https://www.facebook.com/messages/t/',
        'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin',
      },
      body: form,
    });
    const raw = (await r.text()).replace(/^for\s*\(;;\);/, '');
    let json;
    try { json = JSON.parse(raw); }
    catch { for (const line of raw.split('\n')) { const t = line.trim(); if (t.startsWith('{')) { try { json = JSON.parse(t); break; } catch { /* next */ } } } }
    if (!json) throw new Error(`non-JSON reply (HTTP ${r.status})`);
    if (json.error) throw new Error(`FB ${json.error}: ${json.errorSummary || json.errorDescription || ''}`);
    const body = json.o0 || json;
    if (body.errors) throw new Error(`graphql: ${JSON.stringify(body.errors).slice(0, 200)}`);
    return body.data || body;
  }

  async threadList(limit = 20) {
    const d = await this.graphql(DOC.threads, { limit, before: null, tags: ['INBOX'], includeDeliveryReceipts: false, includeSeqID: true }, 'MessengerThreadlistQuery');
    const mt = (d.viewer || {}).message_threads || {};
    const nodes = mt.nodes || [];
    return {
      seq: Number(mt.sync_sequence_id || 0),
      threads: nodes.map((n) => ({
        threadID: String((n.thread_key || {}).thread_fbid || (n.thread_key || {}).other_user_id || ''),
        name: n.name || ((n.all_participants || {}).nodes || []).map((u) => u.name).join(', ') || null,
        snippet: String((((n.last_message || {}).nodes || [])[0] || {}).snippet || ''),
        unreadCount: n.unread_count ?? 0,
        messageCount: (n.messages || {}).count ?? null,
        timestamp: n.updated_time_precise || n.updated_time || null,
        isGroup: Boolean(n.thread_key && n.thread_key.thread_fbid),
      })).filter((t) => t.threadID),
    };
  }


  /* Batch Relay call (the /api/graphqlbatch/ shape). */
  async batch(queries, name = 'batch') {
    if (!this.tk) await this.login();
    const form = new URLSearchParams({
      av: this.userID, __user: this.userID, __a: '1', __req: '1', __hs: this.tk.hs,
      __ccg: 'EXCELLENT', __rev: this.tk.rev, __hsi: this.tk.hsi, __comet_req: '15',
      lsd: this.tk.lsd, jazoest: jazoest(this.tk.dtsg), fb_dtsg: this.tk.dtsg,
      __spin_r: this.tk.rev, __spin_b: 'trunk', __spin_t: String(Math.floor(Date.now() / 1000)),
      queries: JSON.stringify(queries),
    });
    const r = await fetch('https://www.facebook.com/api/graphqlbatch/', {
      method: 'POST',
      headers: {
        ...HEADERS, cookie: this.cookie, accept: '*/*',
        'content-type': 'application/x-www-form-urlencoded',
        'x-requested-with': 'XMLHttpRequest', 'x-fb-lsd': this.tk.lsd, 'x-asbd-id': '129477',
        'x-fb-friendly-name': name,
        origin: 'https://www.facebook.com', referer: 'https://www.facebook.com/messages/t/',
        'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin',
      },
      body: form,
    });
    const raw = (await r.text()).replace(/^for\s*\(;;\);/, '');
    const objects = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try { objects.push(JSON.parse(t)); } catch { /* skip */ }
    }
    if (!objects.length) throw new Error('empty batch reply');
    const first = objects.find((o) => o.error);
    if (first) throw new Error(`FB ${first.error}: ${first.errorSummary || ''}`);
    return objects;
  }

  /* Profile lookup for a list of ids. */
  async userInfo(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).map(String);
    const objs = await this.batch({ o0: { doc_id: '5009315269112105', query_params: { ids: list } } }, 'UsersQuery');
    const out = {};
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (o.id && (o.name !== undefined || o.firstName !== undefined) && String(o.id).match(/^\d+$/)) {
        out[String(o.id)] = {
          userID: String(o.id),
          name: o.name || [o.firstName, o.lastName].filter(Boolean).join(' ') || null,
          firstName: o.firstName || null,
          vanity: o.username || o.vanity || null,
          profileUrl: o.url || (o.username ? `https://www.facebook.com/${o.username}` : null),
          thumbSrc: (o.big_image && o.big_image.uri) || (o.profile_picture && o.profile_picture.uri) || null,
          gender: typeof o.gender === 'number' ? o.gender : null,
          isFriend: o.is_friend === true,
        };
        return;
      }
      Object.values(o).forEach(walk);
    };
    objs.forEach((o) => walk(o.o0 ? o.o0.data : o.data));
    list.forEach((id) => { if (!out[id]) out[id] = { userID: id, name: null, firstName: null }; });
    return out;
  }

  /* One thread's messages. */
  async threadHistory(threadID, amount = 20, before = null) {
    const objs = await this.batch({
      o0: { doc_id: '1498317363570230', query_params: { id: String(threadID), message_limit: amount, load_messages: 1, load_read_receipts: false, before } },
    }, 'ThreadHistoryQuery');
    const data = (objs[0] || {}).o0 ? objs[0].o0.data : {};
    const nodes = ((((data.message_thread || {}).messages) || {}).nodes) || [];
    return nodes.map((m) => ({
      messageID: String(m.message_id || ''),
      senderID: String(m.message_sender && m.message_sender.id || ''),
      body: String(m.message && m.message.text || ''),
      timestamp: String(m.timestamp_precise || m.timestamp || ''),
      attachments: m.blob_attachments || [],
      type: m.__typename || 'message',
    })).filter((m) => m.messageID);
  }

  /* Full thread info. */
  async threadInfo(threadID) {
    const objs = await this.batch({
      o0: { doc_id: '3449967031715030', query_params: { id: String(threadID), message_limit: 0, load_messages: false, load_read_receipts: false, before: null } },
    }, 'ThreadInfoQuery');
    const data = (objs[0] || {}).o0 ? objs[0].o0.data : {};
    const t = data.message_thread || {};
    const edges = (t.all_participants || {}).edges || [];
    const users = edges.map((e) => {
      const u = (e.node || {}).messaging_actor || {};
      return {
        userID: String(u.id || ''), name: u.name || null, firstName: u.name || null,
        profileUrl: u.url || null, thumbSrc: (u.big_image_src || {}).uri || null,
        gender: u.gender || null, isAdmin: Boolean(e.admin_type),
      };
    }).filter((u) => u.userID);
    const admins = (t.thread_admins || []).map((a) => String(a.id));
    return {
      threadID: String((t.thread_key && (t.thread_key.thread_fbid || t.thread_key.other_user_id)) || threadID),
      threadName: t.name || null,
      userInfo: users,
      participantIDs: users.map((u) => u.userID),
      adminIDs: admins,
      isGroup: Boolean(t.thread_key && t.thread_key.thread_fbid),
      messageCount: t.messages_count || null,
      image: (t.image || null),
      emoji: t.customization_info ? t.customization_info.emoji : null,
      color: t.customization_info ? t.customization_info.outgoing_bubble_color : null,
      nicknames: {},
      approvalMode: Boolean(t.approval_mode),
      mutedUntil: t.mute_until || null,
      archived: Boolean(t.has_viewer_archived),
    };
  }

  getAppState() { return this.state.map((c) => ({ ...c })); }
  getCookies() { return this.cookie; }
}

module.exports = { Session, HEADERS, DOC, UA };
