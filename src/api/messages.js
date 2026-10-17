'use strict';
/* messages — send, edit, unsend, react, read state. */

module.exports = function register(ctx) {
  const { session } = ctx;

  async function send(threadID, text, replyTo) {
    const t = await ctx.ensureTransport();
    return t.send(threadID, text, replyTo);
  }

  const api = {
    sendMessage(msg, threadID, callback, replyTo) {
      const text = typeof msg === 'string' ? msg : (msg && (msg.body || msg.text)) || '';
      const reply = replyTo || (msg && msg.replyToMessage);
      ctx.nodeify(send(threadID, text, reply), callback);
    },

    editMessage(text, messageID, callback) {
      ctx.nodeify(ctx.task({
        label: '742',
        queue: ctx.threadOf(messageID) || 'edit_message',
        payload: { message_id: String(messageID), text: String(text) },
      }), callback);
    },

    unsendMessage(messageID, callback) {
      ctx.nodeify(ctx.task({
        label: '33', queue: 'unsend_message',
        payload: { message_id: String(messageID), thread_key: ctx.threadOf(messageID) || '', sync_group: 1 },
      }), callback);
    },

    deleteMessage(threadID, callback) {
      ctx.nodeify(ctx.task({
        label: '146', queue: String(threadID),
        payload: { thread_key: String(threadID), remove_type: 0, sync_group: 1 },
      }), callback);
    },

    addReaction(reaction, messageID, callback, forceCustomReaction) {
      ctx.nodeify(ctx.task({
        label: '29', queue: ctx.threadOf(messageID) || 'reaction',
        payload: {
          thread_key: ctx.threadOf(messageID) || '',
          timestamp_ms: Date.now(),
          message_id: String(messageID),
          reaction: String(reaction || ''),
          actor_id: session.userID,
          reaction_style: forceCustomReaction ? 1 : null,
          sync_group: 1,
          send_attribution: 65537,
          dataclass_params: null,
        },
      }), callback);
    },

    markAsRead(threadID, callback) {
      ctx.nodeify(ctx.task({
        label: '21', queue: String(threadID),
        payload: { thread_id: String(threadID), last_read_watermark_ts: Date.now(), sync_group: 1 },
      }), callback);
    },

    markAsDelivered(threadID, callback) {
      ctx.nodeify(Promise.resolve(true), callback);
    },
  };

  api.setMessageReaction = api.addReaction;
  api.deleteThread = api.deleteMessage;
  api.markAsSeen = api.markAsRead;
  return api;
};
