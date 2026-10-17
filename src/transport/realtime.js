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
    this.client = null;
    this.handlers = [];
    this.ready_ = false;
    this.onError = null;
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
      username: JSON.stringify(username), clean: true, keepalive: 30,
      reconnectPeriod: 0, connectTimeout: 20000,
    };

    this.client = new mqtt.MqttClient(() => socketStream(url, headers), options);
    this.client.on('error', (e) => {
      const err = new FcaError('MQTT_ERROR', String(e.message || e));
      if (this.onError) this.onError(err);
      this.emit({ type: 'error', error: err.message });
    });
    this.client.on('message', (topic, raw) => this.handle(topic, raw));
    return this;
  }

  handle(topic, raw) {
    if (topic !== '/t_ms') return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.errorCode) { this.emit({ type: 'error', error: String(msg.errorCode) }); return; }
    for (const delta of (msg.deltas || [])) {
      const event = deltaToEvent(delta);
      if (event) this.emit(event);
    }
  }

  ready(seqId = 0) {
    if (this.ready_ && this.client && this.client.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new FcaError('MQTT_TIMEOUT', 'mqtt connect timeout')), 20000);
      this.onError = (err) => { clearTimeout(timer); reject(err); };
      this.client.once('error', (e) => { clearTimeout(timer); reject(new FcaError('MQTT_ERROR', String(e.message || e))); });
      this.client.once('connect', () => {
        this.client.subscribe(TOPICS, (err) => {
          if (err) { clearTimeout(timer); return reject(new FcaError('SUBSCRIBE_FAILED', err.message)); }
          this.client.publish('/messenger_sync_create_queue', JSON.stringify({
            sync_api_version: 11, max_deltas_able_to_process: 100, delta_batch_size: 500,
            encoding: 'JSON', entity_fbid: this.c.userID, initial_titan_sequence_id: seqId, device_params: null,
          }), { qos: 0 });
          this.client.publish('/foreground_state', JSON.stringify({ foreground: true }), { qos: 0 });
          clearTimeout(timer);
          this.ready_ = true;
          resolve();
        });
      });
    });
  }

  send(threadID, text, replyTo) {
    const { requestId, content } = this._sendEnvelope(threadID, text, replyTo);
    return this._awaitAck(requestId, (payload) => {
      const ids = extractAck(payload);
      return { messageID: ids.messageID, threadID: ids.threadID || String(threadID) };
    });
  }

  _sendEnvelope(threadID, text, replyTo) {
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
    return this._awaitAck(requestId, (payload) => payload);
  }

  _awaitAck(requestId, map) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.client.connected) return reject(new FcaError('NOT_CONNECTED', 'transport is not connected'));
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
      }, 15000);
    });
  }

  emit(event) { for (const fn of this.handlers) { try { fn(event); } catch { /* isolate */ } } }
  on(fn) { this.handlers.push(fn); return this; }
  close() { try { this.client.end(true); } catch { /* noop */ } this.client = null; this.ready_ = false; }
}

module.exports = { Realtime };
