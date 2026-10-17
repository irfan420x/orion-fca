'use strict';
/* messages — send, edit, unsend, react, read state. */

const { TASK_LABELS } = require('../protocol/endpoints');

module.exports = (ctx) => {
  const { client } = ctx;

  const api = {
    sendMessage(msg, threadID, callback, replyToMessage) {
      const text = typeof msg === 'string' ? msg : (msg && (msg.body || msg.text)) || '';
      const replyTo = replyToMessage || (msg && msg.replyToMessage);
      ctx.nodeify(ctx.rt().then((rt) => rt.send(threadID, text, replyTo)), callback);
    },

    editMessage(text, messageID, callback) {
      ctx.nodeify(ctx.task({
        label: TASK_LABELS.editMessage,
        queue: ctx.threadOf(messageID) || 'edit_message',
        payload: { message_id: String(messageID), text: String(text) },
      }), callback);
    },

    unsendMessage(messageID, callback) {
      ctx.nodeify(ctx.task({
        label: TASK_LABELS.unsend,
        queue: 'unsend_message',
        payload: { message_id: String(messageID), thread_key: ctx.threadOf(messageID) || '', sync_group: 1 },
      }), callback);
    },

    deleteMessage(threadID, callback) {
      ctx.nodeify(ctx.task({
        label: TASK_LABELS.deleteThread,
        queue: String(threadID),
        payload: { thread_key: String(threadID), remove_type: 0, sync_group: 1 },
      }), callback);
    },

    addReaction(reaction, messageID, callback, forceCustomReaction) {
      ctx.nodeify(ctx.task({
        label: TASK_LABELS.reaction,
        queue: ctx.threadOf(messageID) || 'reaction',
        payload: {
          thread_key: ctx.threadOf(messageID) || '',
          timestamp_ms: Date.now(),
          message_id: String(messageID),
          reaction: String(reaction || ''),
          actor_id: client.userID,
          reaction_style: forceCustomReaction ? 1 : null,
          sync_group: 1,
          send_attribution: 65537,
          dataclass_params: null,
        },
      }), callback);
    },

    markAsRead(threadID, callback) {
      ctx.nodeify(ctx.task({
        label: TASK_LABELS.markRead,
        queue: String(threadID),
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
