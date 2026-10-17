'use strict';
/* messages — send, edit, unsend, react, read state.
 * Every write goes through the outbox so duplicates and bursts are absorbed. */

const { TASK_LABELS } = require('../protocol/endpoints');

module.exports = (ctx) => {
  const { client } = ctx;

  const api = {
    sendMessage(msg, threadID, callback, replyToMessage) {
      const text = typeof msg === 'string' ? msg : (msg && (msg.body || msg.text)) || '';
      const replyTo = replyToMessage || (msg && msg.replyToMessage);
      const attachment = msg && typeof msg === 'object'
        ? (msg.attachment || msg.image || msg.file || null)
        : null;
      const noAck = Boolean(msg && typeof msg === 'object' && msg.noAck);

      // A fire-and-forget reply must not sit behind another send in a lane:
      // a stalled ack would delay every message on that thread for minutes.
      if (noAck) {
        return ctx.nodeify((async () => {
          let fbids = null;
          if (attachment) {
            const { uploadFile } = require('../transport/upload');
            fbids = (await uploadFile(client, attachment)).ids;
          }
          const rt = await ctx.rt();
          return rt.sendFast(threadID, text, replyTo, fbids);
        })(), callback);
      }

      ctx.nodeify(ctx.write({
        name: 'sendMessage',
        args: [text || (attachment ? '[media]' : ''), threadID],
        lane: `thread:${threadID}`,
        key: `send:${threadID}:${String(text).slice(0, 64)}:${replyTo || ''}:${attachment && (attachment.path || attachment.filename) || ''}`,
        run: async () => {
          let fbids = null;
          if (attachment) {
            const { uploadFile } = require('../transport/upload');
            fbids = (await uploadFile(client, attachment)).ids;
          }
          const rt = await ctx.rt();
          return rt.send(threadID, text, replyTo, fbids);
        },
      }), callback);
    },

    editMessage(text, messageID, callback) {
      ctx.nodeify(ctx.write({
        name: 'editMessage',
        args: [text, messageID],
        lane: `thread:${ctx.threadOf(messageID) || 'unknown'}`,
        key: `edit:${messageID}`,
        run: () => ctx.task({
          label: TASK_LABELS.editMessage,
          queue: ctx.threadOf(messageID) || 'edit_message',
          payload: { message_id: String(messageID), text: String(text) },
        }),
      }), callback);
    },

    unsendMessage(messageID, callback) {
      ctx.nodeify(ctx.write({
        name: 'unsendMessage',
        args: [messageID],
        lane: `thread:${ctx.threadOf(messageID) || 'unknown'}`,
        key: `unsend:${messageID}`,
        run: () => ctx.task({
          label: TASK_LABELS.unsend,
          queue: 'unsend_message',
          payload: { message_id: String(messageID), thread_key: ctx.threadOf(messageID) || '', sync_group: 1 },
        }),
      }), callback);
    },

    deleteMessage(threadID, callback) {
      ctx.nodeify(ctx.write({
        name: 'deleteMessage',
        args: [threadID],
        lane: `thread:${threadID}`,
        key: `delete:${threadID}`,
        run: () => ctx.task({
          label: TASK_LABELS.deleteThread,
          queue: String(threadID),
          payload: { thread_key: String(threadID), remove_type: 0, sync_group: 1 },
        }),
      }), callback);
    },

    addReaction(reaction, messageID, callback, forceCustomReaction) {
      ctx.nodeify(ctx.write({
        name: 'addReaction',
        args: [reaction, messageID],
        lane: `thread:${ctx.threadOf(messageID) || 'unknown'}`,
        key: `react:${messageID}:${reaction}`,
        run: () => ctx.task({
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
        }),
      }), callback);
    },

    markAsRead(threadID, callback) {
      ctx.nodeify(ctx.write({
        name: 'markAsRead',
        args: [threadID],
        lane: `thread:${threadID}`,
        key: `read:${threadID}`,
        run: () => ctx.task({
          label: TASK_LABELS.markRead,
          queue: String(threadID),
          payload: { thread_id: String(threadID), last_read_watermark_ts: Date.now(), sync_group: 1 },
        }),
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
