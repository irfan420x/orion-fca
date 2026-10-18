'use strict';
/* Realtime transport — MQTT over WebSocket.
 *
 * Two Facebook quirks make the stock client unusable:
 *   1. the server echoes no subprotocol, so mqtt.connect() fails; we hand it a
 *      Duplex built on our own `ws` socket, buffering writes until `open`
 *   2. its PUBACK is non-standard, so publishes go out at QoS 0 and the real
 *      acknowledgement is the application-level reply on /ls_resp
 */

const crypto = require('crypto');
const { Duplex } = require('stream');
const mqtt = require('mqtt');
const WebSocket = require('ws');

const { TOPICS } = require('../protocol/topics');
const { buildTask, extractAck } = require('./requests');
const { deltaToEvent } = require('../utils/normalize');
const { FcaError } = require('../core/errors');
const { UA } = require('./http');

function socketStream(url, headers) {
  const ws = new WebSocket(url, { headers, origin: 'https://www.facebook.com', perMessageDeflate: false });
  let open = false;
  const pending = [];

  const stream = new Duplex({
    read() {},
    write(chunk, enc, cb) {
      if (open) { try { ws.send(chunk); cb(); } catch (e) { cb(e); } } else { pending.push(chunk); cb(); }
    },
    final(cb) { try { ws.close(); } catch { /* noop */ } cb(); },
  });

  ws.on('open', () => {
    open = true;
    for (const chunk of pending) { try { ws.send(chunk); } catch { /* noop */ } }
    pending.length = 0;
  });
  ws.on('message', (data) => stream.push(Buffer.from(data)));
  ws.on('error', (e) => stream.destroy(e));
  ws.on('close', () => stream.push(null));
  return stream;
}

class Realtime {
  constructor(client) {
    this.c = client;
    this.lastDeltaAt = Date.now();
    this.watchdog = null;
    this.client = null;
    this.handlers = [];
    this.ready_ = false;
    this.onError = null;
    this.seq = 0;
    this._seqSavedAt = 0;
    this.seqFile = (client.options && client.options.seqFile) || (client.opts && client.opts.seqFile) || null;
    this._loadSeq();
  }

  /* The sync sequence is what stops a restart from replaying the whole queue
   * or sitting silent until Facebook decides to resend. Keep it on disk. */
  _loadSeq() {
    if (!this.seqFile) return;
    try {
      const raw = require('fs').readFileSync(this.seqFile, 'utf8');
      const n = Number(JSON.parse(raw).seq || 0);
      if (Number.isFinite(n) && n > 0) this.seq = n;
    } catch { /* first run */ }
  }

  _saveSeq() {
    if (!this.seqFile) return;
    const now = Date.now();
    if (now - this._seqSavedAt < 2000) return;
    this._seqSavedAt = now;
    try {
      const fs = require('fs');
      const dir = require('path').dirname(this.seqFile);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.seqFile, JSON.stringify({ seq: this.seq, at: now }));
    } catch { /* best effort */ }
  }

  connect() {
    const sid = Math.floor(Math.random() * 9e15) + 1;
    const clientId = crypto.randomBytes(8).toString('hex');
    const username = {
      u: this.c.userID, s: sid, chat_on: true, fg: false, d: clientId, ct: 'websocket',
      aid: 219994525426954, aids: null, mqtt_sid: '', cp: 3, ecp: 10, st: [], pm: [],
      dc: '', no_auto_fg: true, gas: null, pack: [], p: null, php_override: '',
    };
    const url = `wss://edge-chat.facebook.com/chat?sid=${sid}&cid=${clientId}`;
    const headers = {
      Cookie: this.c.cookie,
      Origin: 'https://www.facebook.com',
      'User-Agent': UA,
      Referer: 'https://www.facebook.com/',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    const options = {
      clientId: 'mqttwsclient', protocolId: 'MQIsdp', protocolVersion: 3,
      username: JSON.stringify(username), clean: true, keepalive: 10,
      reschedulePings: false, reconnectPeriod: 0, connectTimeout: 20000,
    };

    this.client = new mqtt.MqttClient(() => socketStream(url, headers), options);
    this.client.on('error', (e) => {
      const err = new FcaError('MQTT_ERROR', String(e.message || e));
      if (this.onError) this.onError(err);
      this.emit({ type: 'error', error: err.message });
      // mirrors the reference client: drop the socket and listen again
      setTimeout(() => this.reconnect(), 1000).unref?.();
    });
    this.client.on('message', (topic, raw) => {
      if (this._handshake) { clearTimeout(this._handshake); this._handshake = null; }
      this.handle(topic, raw);
    });

    // if the queue is not acknowledged shortly after connecting, the socket is
    // half-open: end it and start over instead of waiting for a keepalive miss
    if (this._handshake) clearTimeout(this._handshake);
    this._handshake = setTimeout(() => {
      this._handshake = null;
      if (this.ready_) return;
      this.emit({ type: 'error', error: 'queue handshake timed out' });
      this.reconnect();
    }, 8000);
    if (this._handshake.unref) this._handshake.unref();
    // a closed socket used to leave the bot deaf until a manual restart
    this.client.on('close', () => {
      if (this._closing) return;
      this.lastDeltaAt = Date.now();
      this.reconnect();
    });
    return this;
  }

  handle(topic, raw) {
    if (topic !== '/t_ms') return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.errorCode) { this.emit({ type: 'error', error: String(msg.errorCode) }); return; }
    for (const delta of (msg.deltas || [])) {
      // raw dump: the only reliable way to learn FB's current reply shape
      try {
        if (delta) {
          const fs = require('fs');
          const dir = process.env.ORION_DATA_DIR || '/home/irfan/Desktop/orion-v2/data/logs';
          const file = `${dir}/deltas.jsonl`;
          try { if (fs.statSync(file).size > 2_000_000) fs.renameSync(file, `${file}.1`); } catch { /* first write */ }
          fs.appendFileSync(file, `${JSON.stringify(delta).slice(0, 4000)}\n`);
        }
      } catch { /* diagnostics must never break delivery */ }

      const event = deltaToEvent(delta);
      if (event) this.emit(event);
    }
  }

  /** Facebook's stream can go quiet without closing. Reconnect when it does. */
  _startWatchdog() {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      const idleMs = Date.now() - this.lastDeltaAt;
      if (!this.client || !this.client.connected) {
        // not connected at all — this is the "silently dead" case
        this.lastDeltaAt = Date.now();
        this.reconnect();
        return;
      }
      if (idleMs > 45000) {
        this.lastDeltaAt = Date.now();
        this.reconnect();
      }
    }, 30000);
    if (this.watchdog.unref) this.watchdog.unref();
  }

  reconnect(attempt = 0) {
    try { if (this.client) this.client.end(true); } catch { /* already gone */ }
    this.client = null;
    this.ready_ = false;
    this.connect();
    this.ready(this.seq || 0).catch(() => {
      const wait = Math.min(15000, 2000 * (attempt + 1));
      setTimeout(() => this.reconnect(attempt + 1), wait).unref?.();
    });
  }

  /** Wait for a live connection instead of failing a reply outright. */
  async _ensureConnected(timeoutMs = 15000) {
    if (this.client && this.client.connected) return true;
    try {
      await Promise.race([
        this.ready(this.seq || 0),
        new Promise((_, rej) => setTimeout(() => rej(new Error('connect wait timeout')), timeoutMs).unref?.()),
      ]);
    } catch { /* fall through */ }
    return Boolean(this.client && this.client.connected);
  }

  ready(seqId = this.seq || 0) {
    if (this.ready_ && this.client && this.client.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new FcaError('MQTT_TIMEOUT', 'mqtt connect timeout')), 20000);
      this.onError = (err) => { clearTimeout(timer); reject(err); };
      this.client.once('error', (e) => { clearTimeout(timer); reject(new FcaError('MQTT_ERROR', String(e.message || e))); });
      this.client.once('connect', () => {
        this.client.subscribe(TOPICS, (err) => {
          if (err) { clearTimeout(timer); return reject(new FcaError('SUBSCRIBE_FAILED', err.message)); }
          this.client.publish('/messenger_sync_create_queue', JSON.stringify({
            sync_api_version: 10, max_deltas_able_to_process: 1000, delta_batch_size: 500,
            encoding: 'JSON', entity_fbid: this.c.userID, initial_titan_sequence_id: seqId, device_params: null,
          }), { qos: 0 });
          this.client.publish('/foreground_state', JSON.stringify({ foreground: true }), { qos: 0 });
          this.client.publish('/set_client_settings', JSON.stringify({ make_user_available_when_in_foreground: true }), { qos: 0 });
          clearTimeout(timer);
          this.ready_ = true;
          this.lastDeltaAt = Date.now();
          this._startWatchdog();
          resolve();
        });
      });
    });
  }

  send(threadID, text, replyTo, attachmentFbids) {
    const { requestId, content } = this._sendEnvelope(threadID, text, replyTo, attachmentFbids);
    return this._awaitAck(requestId, content, (payload) => {
      const ids = extractAck(payload);
      return { messageID: ids.messageID, threadID: ids.threadID || String(threadID) };
    });
  }

  /** Publish without waiting for the ack — Facebook takes ~2.5s to confirm,
   *  and nothing that does not need the message id should wait that long. */
  sendFast(threadID, text, replyTo, attachmentFbids) {
    const { content } = this._sendEnvelope(threadID, text, replyTo, attachmentFbids);
    return new Promise(async (resolve, reject) => {
      const ok = await this._ensureConnected().catch(() => false);
      if (!ok || !this.client || !this.client.connected) {
        return reject(new FcaError('NOT_CONNECTED', 'transport is not connected'));
      }
      this.client.publish('/ls_req', JSON.stringify(content), { qos: 0 }, (err) => {
        if (err) return reject(err);
        resolve({ messageID: null, threadID: String(threadID), queued: true });
      });
    });
  }

  _sendEnvelope(threadID, text, replyTo, attachmentFbids) {
    const { TASK_VERSIONS } = require('../protocol/endpoints');
    const base = {
      thread_id: String(threadID),
      otid: ((BigInt(Date.now()) << 22n) | BigInt(Math.floor(Math.random() * 4000))).toString(),
      source: 2097153, send_type: 1, sync_group: 1, mark_thread_read: 1,
      text, initiating_source: 0, skip_url_preview_gen: 0,
      text_has_links: /(https?:\/\/|www\.)/i.test(text) ? 1 : 0, multitab_env: 0,
      metadata_dataclass: JSON.stringify({ media_accessibility_metadata: { alt_text: null } }),
    };
    if (replyTo) base.reply_metadata = { reply_source_id: replyTo, reply_source_type: 1, reply_type: 0 };
    if (Array.isArray(attachmentFbids) && attachmentFbids.length) {
      base.send_type = 3;                 // 1 = text only, 3 = media
      if (!base.text) base.text = null;
      base.attachment_fbids = attachmentFbids.map(String);
    }

    const requestId = Math.floor(100 + Math.random() * 900);
    const content = {
      app_id: '2220391788200892',
      payload: JSON.stringify({
        tasks: [
          { label: '46', payload: JSON.stringify(base), queue_name: String(threadID), task_id: 400, failure_count: null },
          {
            label: '21',
            payload: JSON.stringify({ thread_id: String(threadID), last_read_watermark_ts: Date.now(), sync_group: 1 }),
            queue_name: String(threadID), task_id: 401, failure_count: null,
          },
        ],
        epoch_id: (BigInt(Date.now()) << 22n).toString(),
        version_id: TASK_VERSIONS.sendMessage,
        data_trace_id: `#${crypto.randomBytes(6).toString('base64').replace(/=+$/, '')}`,
      }),
      request_id: requestId,
      type: 3,
    };
    return { requestId, content };
  }

  task(spec) {
    const { requestId, content } = buildTask(spec);
    return this._awaitAck(requestId, content, (payload) => payload);
  }

  _awaitAck(requestId, content, map, attempt = 0) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.client.connected) {
        // one queued retry after the link returns, instead of a hard failure
        if (attempt >= 2) return reject(new FcaError('NOT_CONNECTED', 'transport is not connected'));
        return this._ensureConnected(20000)
          .then((ok) => (ok
            ? this._awaitAck(requestId, content, map, attempt + 1).then(resolve, reject)
            : reject(new FcaError('NOT_CONNECTED', 'transport is not connected'))))
          .catch((e) => reject(e));
      }
      const onMessage = (topic, raw) => {
        if (topic !== '/ls_resp') return;
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (String(msg.request_id) !== String(requestId)) return;
        this.client.removeListener('message', onMessage);
        let payload = msg.payload;
        try { payload = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch { /* keep */ }
        if (payload && payload.error) return reject(new FcaError('TASK_FAILED', String(payload.error)));
        resolve(map(payload));
      };
      this.client.on('message', onMessage);
      this.client.publish('/ls_req', JSON.stringify(content), { qos: 0 }, (err) => err && reject(err));
      setTimeout(() => {
        this.client.removeListener('message', onMessage);
        reject(new FcaError('ACK_TIMEOUT', 'no reply on /ls_resp'));
      }, 8000);
    });
  }

  emit(event) { for (const fn of this.handlers) { try { fn(event); } catch { /* isolate */ } } }
  on(fn) { this.handlers.push(fn); return this; }

  /** Detach a handler — re-attaching must not leak listeners into the emitter. */
  off(fn) {
    const i = this.handlers.indexOf(fn);
    if (i !== -1) this.handlers.splice(i, 1);
    return this;
  }
  close() {
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
    try { this.client.end(true); } catch { /* noop */ }
    this.client = null;
    this.ready_ = false;
  }
}

module.exports = { Realtime };
