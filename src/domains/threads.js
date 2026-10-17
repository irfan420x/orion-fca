'use strict';
/* threads — list, metadata, history. */

const { threadList, threadInfo, threadHistory } = require('../queries/threads');
const { notImplemented } = require('../core/errors');

module.exports = (ctx) => {
  const { client, state } = ctx;

  return {
    getThreadList(limit, timestamp, tags, callback) {
      if (typeof tags === 'function') callback = tags;
      ctx.nodeify(threadList(client, Number(limit) || 20).then((r) => {
        r.threads.forEach((t) => state.threads.set(t.threadID, t));
        return r.threads;
      }), callback);
    },

    getThreadInfo(threadID, callback) {
      ctx.nodeify(threadInfo(client, threadID).then((info) => {
        state.threads.set(String(threadID), info);
        return info;
      }), callback);
    },

    getThreadHistory(threadID, amount, timestamp, callback) {
      ctx.nodeify(threadHistory(client, threadID, Number(amount) || 20, timestamp || null), callback);
    },

    changeArchivedStatus(threadID, archived, callback) {
      ctx.nodeify(Promise.reject(notImplemented('changeArchivedStatus')), callback);
    },

    handleMessageRequest(threadID, accept, callback) {
      ctx.nodeify(Promise.reject(notImplemented('handleMessageRequest')), callback);
    },
  };
};
