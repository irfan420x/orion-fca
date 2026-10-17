'use strict';
/* groups — participants, admins, nickname, title, theme, image. */

module.exports = function register(ctx) {
  const api = {
    addUserToGroup(userIDs, threadID, callback) {
      ctx.nodeify(ctx.task({
        label: '23', version: '24502707779384158', queue: String(threadID),
        payload: {
          thread_key: String(threadID),
          contact_ids: [].concat(userIDs).map(String),
          sync_group: 1,
        },
      }), callback);
    },

    removeUserFromGroup(userID, threadID, callback) {
      ctx.nodeify(ctx.task({
        label: '140', version: '25002366262773827', queue: 'remove_participant_v2',
        payload: { thread_id: String(threadID), contact_id: String(userID), sync_group: 1 },
      }), callback);
    },

    changeNickname(nickname, threadID, participantID, callback) {
      ctx.nodeify(ctx.task({
        label: '44', queue: 'thread_participant_nickname',
        payload: {
          thread_key: String(threadID),
          contact_id: String(participantID),
          nickname: nickname || '',
          sync_group: 1,
        },
      }), callback);
    },

    setTitle(title, threadID, callback) {
      ctx.nodeify(ctx.task({
        label: '32', queue: String(threadID),
        payload: { thread_key: String(threadID), thread_name: String(title), sync_group: 1 },
      }), callback);
    },

    changeAdminStatus(threadID, ids, status, callback) {
      ctx.nodeify(Promise.all([].concat(ids).map((id) => ctx.task({
        label: '25', queue: 'admin_status',
        payload: { thread_key: String(threadID), contact_id: String(id), is_admin: status ? 1 : 0 },
      }))), callback);
    },

    changeThreadEmoji(emoji, threadID, callback) {
      ctx.nodeify(ctx.task({
        label: '100003', queue: 'thread_quick_reaction',
        payload: {
          thread_key: String(threadID),
          custom_emoji: String(emoji),
          avatar_sticker_instruction_key_id: null,
          sync_group: 1,
        },
      }), callback);
    },

    changeThreadColor(color, threadID, callback) {
      ctx.nodeify(ctx.task({
        label: '43', queue: 'thread_theme',
        payload: {
          thread_key: String(threadID),
          theme_fbid: String(color),
          source: null,
          sync_group: 1,
          payload: null,
        },
      }), callback);
    },

    changeGroupImage(imageID, threadID, callback) {
      if (typeof imageID !== 'string' || !/^\d+$/.test(imageID)) {
        return ctx.nodeify(Promise.reject('changeGroupImage needs an uploaded image id (upload not built yet)'), callback);
      }
      ctx.nodeify(ctx.task({
        label: '37', queue: 'thread_image',
        payload: { thread_key: String(threadID), image_id: imageID, sync_group: 1 },
      }), callback);
    },
  };

  return api;
};
