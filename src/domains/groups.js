'use strict';
/* groups — participants, admins, nickname, title, theme, image. */

const { TASK_LABELS, TASK_VERSIONS } = require('../protocol/endpoints');
const { notImplemented } = require('../core/errors');

module.exports = (ctx) => {
  const api = {
    addUserToGroup(userIDs, threadID, callback) {
      ctx.guard('addUserToGroup', [userIDs, threadID]);
      return ctx.nodeify(ctx.task({
        label: TASK_LABELS.addUsers,
        version: TASK_VERSIONS.addUsers,
        queue: String(threadID),
        payload: { thread_key: String(threadID), contact_ids: [].concat(userIDs).map(String), sync_group: 1 },
      }), callback);
    },

    removeUserFromGroup(userID, threadID, callback) {
      ctx.guard('removeUserFromGroup', [userID, threadID]);
      return ctx.nodeify(ctx.task({
        label: TASK_LABELS.removeUser,
        version: TASK_VERSIONS.removeUser,
        queue: 'remove_participant_v2',
        payload: { thread_id: String(threadID), contact_id: String(userID), sync_group: 1 },
      }), callback);
    },

    changeNickname(nickname, threadID, participantID, callback) {
      ctx.guard('changeNickname', [nickname, threadID, participantID]);
      return ctx.nodeify(ctx.task({
        label: TASK_LABELS.nickname,
        queue: 'thread_participant_nickname',
        payload: {
          thread_key: String(threadID),
          contact_id: String(participantID),
          nickname: nickname || '',
          sync_group: 1,
        },
      }), callback);
    },

    setTitle(title, threadID, callback) {
      ctx.guard('setTitle', [title, threadID]);
      return ctx.nodeify(ctx.task({
        label: TASK_LABELS.title,
        queue: String(threadID),
        payload: { thread_key: String(threadID), thread_name: String(title), sync_group: 1 },
      }), callback);
    },

    changeAdminStatus(threadID, ids, status, callback) {
      return ctx.nodeify(Promise.all([].concat(ids).map((id) => ctx.task({
        label: TASK_LABELS.adminStatus,
        queue: 'admin_status',
        payload: { thread_key: String(threadID), contact_id: String(id), is_admin: status ? 1 : 0 },
      }))), callback);
    },

    changeThreadEmoji(emoji, threadID, callback) {
      ctx.guard('changeThreadEmoji', [emoji, threadID]);
      return ctx.nodeify(ctx.task({
        label: TASK_LABELS.emoji,
        queue: 'thread_quick_reaction',
        payload: {
          thread_key: String(threadID),
          custom_emoji: String(emoji),
          avatar_sticker_instruction_key_id: null,
          sync_group: 1,
        },
      }), callback);
    },

    changeThreadColor(color, threadID, callback) {
      ctx.guard('changeThreadColor', [color, threadID]);
      return ctx.nodeify(ctx.task({
        label: TASK_LABELS.theme,
        queue: 'thread_theme',
        payload: { thread_key: String(threadID), theme_fbid: String(color), source: null, sync_group: 1, payload: null },
      }), callback);
    },

    changeGroupImage(imageID, threadID, callback) {
      ctx.guard('changeGroupImage', [imageID, threadID]);
      if (typeof imageID !== 'string' || !/^\d+$/.test(imageID)) {
        return ctx.nodeify(Promise.reject(notImplemented('changeGroupImage without an uploaded image id')), callback);
      }
      return ctx.nodeify(ctx.task({
        label: TASK_LABELS.threadImage,
        queue: 'thread_image',
        payload: { thread_key: String(threadID), image_id: imageID, sync_group: 1 },
      }), callback);
    },

    changeAvatar(image, callback) {
      return ctx.nodeify(Promise.reject(notImplemented('changeAvatar')), callback);
    },
  };

  return api;
};
