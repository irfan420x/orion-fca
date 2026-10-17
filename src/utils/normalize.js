'use strict';
/* Delta → normalized event. Facebook's wire format is not our public format. */

function threadOf(d) {
  const meta = d.messageMetadata || {};
  const tk = meta.threadKey || d.threadKey || {};
  return String(tk.threadFbId || tk.otherUserFbId || (meta.cid && meta.cid.conversationFbid) || '');
}

/**
 * Facebook sends reply context in two shapes:
 *   d.deltaMessageReply.repliedToMessage.messageMetadata → full author + body
 *   d.deltaMessageReply.replyToMessageId → id only
 * messageMetadata.replyToMessageId also shows up on some builds.
 * Read all three; the dispatcher resolves the author when only an id is given.
 */
function replyOf(d, meta) {
  const reply = d.deltaMessageReply;

  if (reply && reply.repliedToMessage) {
    const rm = reply.repliedToMessage.messageMetadata || {};
    if (rm.messageId || rm.actorFbId) {
      return {
        messageID: String(rm.messageId || ''),
        senderID: rm.actorFbId ? String(rm.actorFbId) : undefined,
        body: String(reply.repliedToMessage.body || ''),
        timestamp: Number(rm.timestamp || 0) || undefined,
      };
    }
  }

  const id = reply && reply.replyToMessageId;
  if (id) {
    return { messageID: String(id.id || id) };
  }

  const mid = meta && meta.replyToMessageId;
  if (mid) {
    return { messageID: String(mid.id || mid) };
  }

  return undefined;
}

function deltaToEvent(d) {
  if (!d || typeof d !== 'object') return null;

  if (d.class === 'NewMessage') {
    const meta = d.messageMetadata || {};
    const threadID = threadOf(d);
    const body = String(d.body || '');
    if (!threadID || (!body && !(d.attachments || []).length)) return null;
    return {
      type: 'message',
      senderID: String(meta.actorFbId || ''),
      threadID,
      messageID: String(meta.messageId || ''),
      body,
      timestamp: Number(meta.timestamp || d.actionTimestampMs || 0) || Date.now(),
      isGroup: Boolean((meta.threadKey || {}).threadFbId),
      participantIDs: Array.isArray(d.participants) ? d.participants.map(String) : [],
      attachments: d.attachments || [],
      mentions: {},
      messageReply: replyOf(d, meta),
    };
  }

  if (d.class === 'ReadReceipt') {
    return {
      type: 'read_receipt',
      threadID: threadOf(d),
      reader: String(d.actorFbId || ''),
      time: Number(d.actionTimestampMs || 0),
    };
  }

  if (d.class === 'TypingIndicator' || d.class === 'Typing') {
    return {
      type: 'typ',
      threadID: threadOf(d),
      userID: String(d.actorFbId || ''),
      isTyping: d.isTyping !== false,
    };
  }

  if (d.class === 'Reaction' || (d.messageMetadata && d.messageMetadata.reaction)) {
    return {
      type: 'message_reaction',
      threadID: threadOf(d),
      messageID: String((d.messageMetadata || {}).messageId || ''),
      userID: String(d.actorFbId || ''),
      reaction: String((d.messageMetadata || {}).reaction || ''),
    };
  }

  return null;
}

module.exports = { deltaToEvent };
