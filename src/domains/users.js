'use strict';
/* users — profiles and friend requests. */

const { userInfo } = require('../queries/users');
const { notImplemented } = require('../core/errors');

module.exports = (ctx) => ({
  getUserInfo(ids, callback) {
    ctx.guard('getUserInfo', [ids]);
    return ctx.nodeify(userInfo(ctx.client, ids), callback);
  },

  handleFriendRequest(userID, accept, callback) {
    return ctx.nodeify(Promise.reject(notImplemented('handleFriendRequest')), callback);
  },
});
