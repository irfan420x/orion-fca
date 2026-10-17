'use strict';
/* Ledger — an event-fed cache of threads and messages.
 *
 * Unlike a plain Map, the ledger:
 *   - keeps a bounded LRU with TTL, so a long-running bot cannot grow forever
 *   - stores messages separately from threads and indexes messageID → threadID,
 *     which is what edit / unsend / reaction need
 *   - records where every fact came from (query | event) and when it was seen,
 *     so callers can tell a stale cache hit from a fresh read
 *   - emits change events, so higher layers never poll
 */

const SOURCE = { QUERY: 'query', EVENT: 'event', WRITE: 'write' };

class Ledger {
  constructor({ ttlMs = 5 * 60 * 1000, maxThreads = 500, maxMessages = 5000 } = {}) {
    this.ttlMs = ttlMs;
    this.maxThreads = maxThreads;
    this.maxMessages = maxMessages;
    this.threads = new Map();  // threadID -> record
    this.messages = new Map(); // messageID -> record
    this.handlers = [];
  }

  /* ---- writes ------------------------------------------------------- */

  putThread(info, source = SOURCE.QUERY) {
    if (!info || !info.threadID) return null;
    const id = String(info.threadID);
    const previous = this.threads.get(id) || {};
    const record = {
      ...previous,
      ...info,
      source,
      seenAt: Date.now(),
    };
    this.threads.delete(id);
    this.threads.set(id, record);
    this._evictThreads();
    this._emit({ type: 'thread', threadID: id, source });
    return record;
  }

  putMessage(message) {
    if (!message || !message.messageID) return null;
    const id = String(message.messageID);
    const record = {
      messageID: id,
      threadID: String(message.threadID || ''),
      senderID: String(message.senderID || ''),
      body: String(message.body || ''),
      timestamp: Number(message.timestamp || Date.now()),
      source: message.source || SOURCE.EVENT,
      seenAt: Date.now(),
    };
    this.messages.delete(id);
    this.messages.set(id, record);

    // keep the item's thread list coherent
    if (record.threadID) {
      const thread = this.threads.get(record.threadID);
      if (thread) {
        thread.lastMessageID = id;
        thread.lastMessageBody = record.body;
        thread.lastMessageAt = record.timestamp;
      }
    }

    this._evictMessages();
    this._emit({ type: 'message', messageID: id, threadID: record.threadID });
    return record;
  }

  putMessages(list) {
    return (list || []).map((m) => this.putMessage(m)).filter(Boolean);
  }

  /* ---- reads -------------------------------------------------------- */

  getThread(threadID, { allowStale = true } = {}) {
    const record = this.threads.get(String(threadID));
    if (!record) return null;
    if (!allowStale && Date.now() - record.seenAt > this.ttlMs) return null;
    this.threads.delete(String(threadID));
    this.threads.set(String(threadID), record); // touch for LRU
    return record;
  }

  getMessage(messageID) {
    return this.messages.get(String(messageID)) || null;
  }

  /** The reason this class exists: every mutation needs the thread of a message. */
  threadOfMessage(messageID) {
    const message = this.getMessage(messageID);
    return message ? message.threadID : null;
  }

  messagesOf(threadID, limit = 20) {
    const id = String(threadID);
    const out = [];
    for (const message of this.messages.values()) {
      if (message.threadID === id) out.push(message);
    }
    return out.sort((a, b) => a.timestamp - b.timestamp).slice(-limit);
  }

  stats() {
    return {
      threads: this.threads.size,
      messages: this.messages.size,
      oldestThreadSeenAt: this.threads.size ? this.threads.values().next().value.seenAt : null,
      ttlMs: this.ttlMs,
    };
  }

  /* ---- maintenance -------------------------------------------------- */

  _evictThreads() {
    const now = Date.now();
    for (const [id, record] of this.threads) {
      if (now - record.seenAt > this.ttlMs) this.threads.delete(id);
    }
    while (this.threads.size > this.maxThreads) {
      const oldest = this.threads.keys().next().value;
      this.threads.delete(oldest);
    }
  }

  _evictMessages() {
    while (this.messages.size > this.maxMessages) {
      const oldest = this.messages.keys().next().value;
      this.messages.delete(oldest);
    }
  }

  _emit(change) { for (const fn of this.handlers) { try { fn(change); } catch { /* isolate */ } } }
  on(fn) { this.handlers.push(fn); return this; }
}

module.exports = { Ledger, SOURCE };
