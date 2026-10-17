'use strict';
/* Capability policy — what this session may do, checked before the wire.
 *
 * The point is failure you can act on: instead of Facebook answering with an
 * opaque number three seconds later, a call that cannot work fails locally with
 * a named reason (and never reaches the network).
 */

const { FcaError } = require('../core/errors');

/**
 * Each entry declares:
 *   transport  – requires an open MQTT session
 *   args       – required argument positions (0-based) and their kind
 *   group      – only meaningful on a group thread
 *   experimental
 */
const CAPABILITIES = {
  sendMessage: { transport: true, args: ['text', 'threadID'] },
  editMessage: { transport: true, args: ['text', 'messageID'] },
  unsendMessage: { transport: true, args: ['messageID'] },
  addReaction: { transport: true, args: ['reaction', 'messageID'] },
  deleteMessage: { transport: true, args: ['threadID'] },
  markAsRead: { transport: true, args: ['threadID'] },
  addUserToGroup: { transport: true, args: ['userIDs', 'threadID'], group: true },
  removeUserFromGroup: { transport: true, args: ['userID', 'threadID'], group: true },
  changeNickname: { transport: true, args: ['nickname', 'threadID', 'participantID'], group: true },
  setTitle: { transport: true, args: ['title', 'threadID'], group: true },
  changeAdminStatus: { transport: true, args: ['threadID', 'ids'], group: true },
  changeThreadEmoji: { transport: true, args: ['emoji', 'threadID'] },
  changeThreadColor: { transport: true, args: ['color', 'threadID'] },
  changeGroupImage: { transport: true, args: ['imageID', 'threadID'], group: true },
  getThreadList: { args: [] },
  getThreadInfo: { args: ['threadID'] },
  getThreadHistory: { args: ['threadID'] },
  getUserInfo: { args: ['ids'] },
  changeArchivedStatus: { experimental: true },
  handleMessageRequest: { experimental: true },
  handleFriendRequest: { experimental: true },
};

const isMissing = (v) => v === undefined || v === null || v === '';

function check(name, args, { ledger } = {}) {
  const spec = CAPABILITIES[name];
  if (!spec) return; // unmapped methods manage their own failure

  for (const arg of spec.args || []) {
    const index = (spec.args || []).indexOf(arg);
    if (isMissing(args[index])) {
      throw new FcaError('INVALID_ARGUMENT', `${name}: "${arg}" is required`);
    }
  }

  if (spec.group && ledger) {
    const threadID = args.find((a) => typeof a === 'string' && /^\d{6,}$/.test(a));
    const thread = threadID ? ledger.getThread(threadID) : null;
    if (thread && thread.isGroup === false) {
      throw new FcaError('NOT_A_GROUP', `${name} only applies to group threads`);
    }
  }

  if (spec.experimental) {
    throw new FcaError('NOT_IMPLEMENTED', `${name} is not mapped to a Facebook endpoint yet`);
  }
}

function describe() {
  return Object.entries(CAPABILITIES).map(([name, spec]) => ({
    name,
    transport: Boolean(spec.transport),
    group: Boolean(spec.group),
    experimental: Boolean(spec.experimental),
    args: spec.args || [],
  }));
}

module.exports = { CAPABILITIES, check, describe };
