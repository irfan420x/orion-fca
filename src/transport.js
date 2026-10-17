'use strict';
/* orion-fca — transport: MQTT over WebSocket (send + delta stream). */

const crypto = require('crypto');
const { Duplex } = require('stream');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const { UA } = require('./session');

const DBG = process.env.ORION_FCA_DEBUG === '1';
const dbg = (...a) => { if (DBG) console.log('[orion-fca]', ...a); };

const TOPICS = ['/ls_req', '/ls_resp', '/legacy_web', '/webrtc', '/rtc_multi', '/onevc', '/br_sr',
  '/sr_res', '/t_ms', '/thread_typing', '/orca_typing_notifications', '/notify_disconnect',
  '/orca_presence', '/inbox', '/mercury', '/messaging_events', '/orca_message_notifications',
  '/pp', '/webrtc_response'];

function wsStream(url, headers) {
  const ws = new WebSocket(url, { headers, origin: 'https://www.facebook.com', perMessageDeflate: false });
  let open = false;
  const pending = [];
  const d = new Duplex({
    read() {},
    write(chunk, enc, cb) {
      if (open) { try { ws.send(chunk); cb(); } catch (e) { cb(e); } } else { pending.push(chunk); cb(); }
    },
    final(cb) { try { ws.close(); } catch { /* noop */ } cb(); },
  });
  ws.on('open', () => { open = true; pending.forEach((c) => { try { ws.send(c); } catch { /* noop */ } }); pending.length = 0; });
  ws.on('message', (data) => d.push(Buffer.from(data)));
  ws.on('error', (e) => d.destroy(e));
  ws.on('close', () => d.push(null));
  return d;
}

function extractIds(payload) {
  let messageID = null; let threadID = null;
  const walk = (n) => {
    if (!Array.isArray(n)) return;
    if (n[0] === 5 && (n[1] === 'replaceOptimsiticMessage' || n[1] === 'replaceOptimisticMessage')) messageID = String(n[3]);
    if (n[0] === 5 && n[1] === 'writeCTAIdToThreadsTable' && Array.isArray(n[2]) && n[2][0] === 19) threadID = String(n[2][1]);
    for (const c of n) walk(c);
  };
  walk((payload || {}).step);
  return { messageID, threadID };
}

class Transport {
  constructor(session) {
    this.s = session;
    this.client = null;
    this.handlers = [];
  }

  connect() {
    const sid = Math.floor(Math.random() * 9e15) + 1;
    const clientId = crypto.randomBytes(8).toString('hex');
    const username = {
      u: this.s.userID, s: sid, chat_on: true, fg: false, d: clientId, ct: 'websocket',
      aid: 219994525426954, aids: null, mqtt_sid: '', cp: 3, ecp: 10, st: [], pm: [],
      dc: '', no_auto_fg: true, gas: null, pack: [], p: null, php_override: '',
    };
    const host = `wss://edge-chat.facebook.com/chat?sid=${sid}&cid=${clientId}`;
    const headers = {
      Cookie: this.s.cookie, Origin: 'https://www.facebook.com', 'User-Agent': UA,
      Referer: 'https://www.facebook.com/', Pragma: 'no-cache', 'Cache-Control': 'no-cache',
      'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'en-US,en;q=0.9',
    };
    const opts = {
      clientId: 'mqttwsclient', protocolId: 'MQIsdp', protocolVersion: 3,
      username: JSON.stringify(username), clean: true, keepalive: 30,
      reconnectPeriod: 0, connectTimeout: 20000,
    };
    this.client = new mqtt.MqttClient(() => wsStream(host, headers), opts);
    this.client.on('error', (e) => this.emit({ type: 'error', error: String(e.message || e) }));
    this.client.on('message', (topic, raw) => this._onMessage(topic, raw));
    return this;
  }

  _onMessage(topic, raw) {
    if (topic === '/t_ms') {
      const t = raw.toString();
      if (process.env.ORION_FCA_DUMP) { try { require('fs').appendFileSync(process.env.ORION_FCA_DUMP, t + '\n'); } catch { /* noop */ } }
      dbg('t_ms', t.slice(0, 100));
    }
    if (topic !== '/t_ms') {
      if (topic === '/mercury' || topic === '/messaging_events') this._onLegacy(topic, raw);
      return;
    }
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.errorCode) { dbg('t_ms error', m.errorCode); this.emit({ type: 'error', error: String(m.errorCode) }); return; }
    dbg('deltas', (m.deltas || []).length);
    for (const d of (m.deltas || [])) this._onDelta(d);
  }

  _onDelta(d) {
    if (d.class === 'NewMessage') {
      const meta = d.messageMetadata || {};
      const tk = meta.threadKey || {};
      const threadID = String(tk.threadFbId || tk.otherUserFbId || (meta.cid && meta.cid.conversationFbid) || '');
      const body = String(d.body || '');
      if (!threadID || (!body && !(d.attachments || []).length)) return;
      this.emit({
        type: 'message',
        senderID: String(meta.actorFbId || ''),
        threadID,
        messageID: String(meta.messageId || ''),
        body,
        timestamp: Number(meta.timestamp || d.actionTimestampMs || 0) || Date.now(),
        isGroup: Boolean(tk.threadFbId),
        participantIDs: Array.isArray(d.participants) ? d.participants.map(String) : [],
        attachments: d.attachments || [],
        mentions: {},
        messageReply: meta.replyToMessageId ? { messageID: String(meta.replyToMessageId) } : undefined,
      });
      return;
    }
    if (d.class === 'ReadReceipt') {
      const tk = d.threadKey || {};
      this.emit({
        type: 'read_receipt',
        threadID: String(tk.threadFbId || tk.otherUserFbId || ''),
        reader: String(d.actorFbId || ''),
        time: Number(d.actionTimestampMs || 0),
      });
      return;
    }
    if (d.class === 'TypingIndicator' || d.class === 'Typing') {
      this.emit({
        type: 'typ',
        threadID: String((d.threadKey || {}).threadFbId || ''),
        userID: String(d.actorFbId || ''),
        isTyping: d.isTyping !== false,
      });
    }
  }

  _onLegacy(topic, raw) {
    let m;
    try { m = JSON.parse(raw.toString().replace(/^for\s*\(;;\);/, '')); } catch { return; }
    if (m.error) this.emit({ type: 'error', error: String(m.error) });
  }

  ready(seqId = 0) {
    if (this._ready && this.client && this.client.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('mqtt connect timeout')), 20000);
      this.client.once('error', (e) => { clearTimeout(t); reject(e); });
      this.client.once('connect', () => {
        this.client.subscribe(TOPICS, (err) => {
          if (err) { clearTimeout(t); return reject(err); }
          this.client.publish('/messenger_sync_create_queue', JSON.stringify({
            sync_api_version: 11, max_deltas_able_to_process: 100, delta_batch_size: 500,
            encoding: 'JSON', entity_fbid: this.s.userID, initial_titan_sequence_id: seqId, device_params: null,
          }), { qos: 0 });
          this.client.publish('/foreground_state', JSON.stringify({ foreground: true }), { qos: 0 });
          clearTimeout(t);
          this._ready = true;
          resolve();
        });
      });
    });
  }

  send(threadID, text, replyTo) {
    const requestId = Math.floor(100 + Math.random() * 900);
    const payload0 = {
      thread_id: String(threadID),
      otid: ((BigInt(Date.now()) << 22n) | BigInt(Math.floor(Math.random() * 4000))).toString(),
      source: 2097153, send_type: 1, sync_group: 1, mark_thread_read: 1, text,
      initiating_source: 0, skip_url_preview_gen: 0,
      text_has_links: /(https?:\/\/|www\.)/i.test(text) ? 1 : 0, multitab_env: 0,
      metadata_dataclass: JSON.stringify({ media_accessibility_metadata: { alt_text: null } }),
    };
    if (replyTo) payload0.reply_metadata = { reply_source_id: replyTo, reply_source_type: 1, reply_type: 0 };
    const content = {
      app_id: '2220391788200892',
      payload: JSON.stringify({
        tasks: [
          { label: '46', payload: JSON.stringify(payload0), queue_name: String(threadID), task_id: 400, failure_count: null },
          { label: '21', payload: JSON.stringify({ thread_id: String(threadID), last_read_watermark_ts: Date.now(), sync_group: 1 }), queue_name: String(threadID), task_id: 401, failure_count: null },
        ],
        epoch_id: (BigInt(Date.now()) << 22n).toString(),
        version_id: '24804310205905615',
        data_trace_id: `#${crypto.randomBytes(6).toString('base64').replace(/=+$/, '')}`,
      }),
      request_id: requestId, type: 3,
    };
    return new Promise((resolve, reject) => {
      const onMsg = (topic, raw) => {
        if (topic !== '/ls_resp') return;
        let m; try { m = JSON.parse(raw.toString()); } catch { return; }
        if (String(m.request_id) !== String(requestId)) return;
        this.client.removeListener('message', onMsg);
        let payload = m.payload;
        try { payload = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch { /* keep */ }
        const ids = extractIds(payload);
        resolve({ messageID: ids.messageID, threadID: ids.threadID || String(threadID) });
      };
      this.client.on('message', onMsg);
      this.client.publish('/ls_req', JSON.stringify(content), { qos: 0 }, (err) => err && reject(err));
      setTimeout(() => { this.client.removeListener('message', onMsg); reject(new Error('send ack timeout')); }, 15000);
    });
  }


  /* Generic /ls_req task — every group/message mutation rides this. */
  task({ label, payload, queue, version = '8798795233522156', timeout = 15000 }) {
    const requestId = Math.floor(100 + Math.random() * 900);
    const content = {
      app_id: '2220391788200892',
      payload: JSON.stringify({
        tasks: [{
          label: String(label),
          payload: JSON.stringify(payload),
          queue_name: String(queue),
          task_id: Math.floor(Math.random() * 1001),
          failure_count: null,
        }],
        epoch_id: (BigInt(Date.now()) << 22n).toString(),
        version_id: version,
        data_trace_id: `#${crypto.randomBytes(6).toString('base64').replace(/=+$/, '')}`,
      }),
      request_id: requestId,
      type: 3,
    };
    return new Promise((resolve, reject) => {
      if (!this.client || !this.client.connected) return reject(new Error('transport not connected'));
      const onMsg = (topic, raw) => {
        if (topic !== '/ls_resp') return;
        let m; try { m = JSON.parse(raw.toString()); } catch { return; }
        if (String(m.request_id) !== String(requestId)) return;
        this.client.removeListener('message', onMsg);
        let payloadOut = m.payload;
        try { payloadOut = typeof payloadOut === 'string' ? JSON.parse(payloadOut) : payloadOut; } catch { /* keep */ }
        if (payloadOut && payloadOut.error) return reject(new Error(String(payloadOut.error)));
        resolve(payloadOut);
      };
      this.client.on('message', onMsg);
      this.client.publish('/ls_req', JSON.stringify(content), { qos: 0 }, (err) => err && reject(err));
      setTimeout(() => { this.client.removeListener('message', onMsg); reject(new Error('task ack timeout')); }, timeout);
    });
  }

  emit(ev) { for (const h of this.handlers) { try { h(ev); } catch { /* noop */ } } }
  on(fn) { this.handlers.push(fn); return this; }
  close() { try { this.client.end(true); } catch { /* noop */ } this.client = null; this._ready = false; }
}

module.exports = { Transport, TOPICS };
