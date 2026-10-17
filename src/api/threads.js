'use strict';
/* threads — listing, metadata, history, archive/message-request. */

module.exports = function register(ctx) {
  const { session, state } = ctx;

  return {
    getThreadList(limit, timestamp, tags, callback) {
      if (typeof tags === 'function') callback = tags;
      ctx.nodeify(session.threadList(Number(limit) || 20).then((r) => {
        r.threads.forEach((t) => state.threads.set(t.threadID, t));
        return r.threads;
      }), callback);
    },

    getThreadInfo(threadID, callback) {
      ctx.nodeify(session.threadInfo(threadID).then((info) => {
        state.threads.set(String(threadID), info);
        return info;
      }), callback);
    },

    getThreadHistory(threadID, amount, timestamp, callback) {
      ctx.nodeify(session.threadHistory(threadID, Number(amount) || 20, timestamp || null), callback);
    },

    changeArchivedStatus(threadID, archived, callback) {
      ctx.nodeify(Promise.reject('changeArchivedStatus is not mapped yet'), callback);
    },

    handleMessageRequest(threadID, accept, callback) {
      ctx.nodeify(Promise.reject('handleMessageRequest is not mapped yet'), callback);
    },
  };
};
