'use strict';
/* users — profile lookup and friend requests. */

module.exports = function register(ctx) {
  const { session } = ctx;

  return {
    getUserInfo(ids, callback) {
      ctx.nodeify(session.userInfo(ids), callback);
    },

    handleFriendRequest(userID, accept, callback) {
      ctx.nodeify(Promise.reject('handleFriendRequest is not mapped yet'), callback);
    },
  };
};
