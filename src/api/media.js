'use strict';
/* media — attachment and avatar upload (not built yet). */

module.exports = function register(ctx) {
  return {
    changeAvatar(image, callback) {
      ctx.nodeify(Promise.reject('changeAvatar needs image upload (not built yet)'), callback);
    },

    uploadAttachment(stream, callback) {
      ctx.nodeify(Promise.reject('uploadAttachment is not built yet'), callback);
    },
  };
};
