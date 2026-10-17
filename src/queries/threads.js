'use strict';
/* Thread reads — the query shapes Facebook's Relay layer expects. */

const { DOC_IDS } = require('../protocol/endpoints');

async function threadList(client, limit = 20) {
  const d = await client.http.graphql(
    DOC_IDS.threadList,
    { limit, before: null, tags: ['INBOX'], includeDeliveryReceipts: false, includeSeqID: true },
    'MessengerThreadlistQuery',
  );
  const mt = (d.viewer || {}).message_threads || {};
  return {
    seq: Number(mt.sync_sequence_id || 0),
    threads: (mt.nodes || []).map((n) => ({
      threadID: String((n.thread_key || {}).thread_fbid || (n.thread_key || {}).other_user_id || ''),
      name: n.name || ((n.all_participants || {}).nodes || []).map((u) => u.name).join(', ') || null,
      snippet: String((((n.last_message || {}).nodes || [])[0] || {}).snippet || ''),
      unreadCount: n.unread_count ?? 0,
      messageCount: (n.messages || {}).count ?? null,
      timestamp: n.updated_time_precise || n.updated_time || null,
      isGroup: Boolean(n.thread_key && n.thread_key.thread_fbid),
    })).filter((t) => t.threadID),
  };
}

async function threadInfo(client, threadID) {
  const [obj] = await client.http.batch({
    o0: {
      doc_id: DOC_IDS.threadInfo,
      query_params: { id: String(threadID), message_limit: 0, load_messages: false, load_read_receipts: false, before: null },
    },
  }, 'ThreadInfoQuery');

  const t = ((obj.o0 || {}).data || {}).message_thread || {};
  const users = ((t.all_participants || {}).edges || []).map((e) => {
    const u = (e.node || {}).messaging_actor || {};
    return {
      userID: String(u.id || ''),
      name: u.name || null,
      firstName: u.name || null,
      profileUrl: u.url || null,
      thumbSrc: (u.big_image_src || {}).uri || null,
      gender: u.gender || null,
      isAdmin: Boolean(e.admin_type),
    };
  }).filter((u) => u.userID);

  return {
    threadID: String((t.thread_key && (t.thread_key.thread_fbid || t.thread_key.other_user_id)) || threadID),
    threadName: t.name || null,
    userInfo: users,
    participantIDs: users.map((u) => u.userID),
    adminIDs: (t.thread_admins || []).map((a) => String(a.id)),
    isGroup: Boolean(t.thread_key && t.thread_key.thread_fbid),
    messageCount: t.messages_count || null,
    image: t.image || null,
    emoji: t.customization_info ? t.customization_info.emoji : null,
    color: t.customization_info ? t.customization_info.outgoing_bubble_color : null,
    nicknames: {},
    approvalMode: Boolean(t.approval_mode),
    mutedUntil: t.mute_until || null,
    archived: Boolean(t.has_viewer_archived),
  };
}

async function threadHistory(client, threadID, amount = 20, before = null) {
  const [obj] = await client.http.batch({
    o0: {
      doc_id: DOC_IDS.threadHistory,
      query_params: { id: String(threadID), message_limit: amount, load_messages: 1, load_read_receipts: false, before },
    },
  }, 'ThreadHistoryQuery');

  const nodes = ((((((obj.o0 || {}).data || {}).message_thread || {}).messages) || {}).nodes) || [];
  return nodes.map((m) => ({
    messageID: String(m.message_id || ''),
    senderID: String((m.message_sender || {}).id || ''),
    body: String((m.message || {}).text || ''),
    timestamp: String(m.timestamp_precise || m.timestamp || ''),
    attachments: m.blob_attachments || [],
    type: m.__typename || 'message',
    // participant notices carry ids, not text — the only reliable join signal
    participants: [...(m.participants_added || []), ...(m.participants_removed || [])]
      .map((p) => ({ userID: String((p && p.id) || p || ''), name: String((p && p.name) || '') }))
      .filter((p) => p.userID),
    added: Array.isArray(m.participants_added) && m.participants_added.length > 0,
    removed: Array.isArray(m.participants_removed) && m.participants_removed.length > 0,
  })).filter((m) => m.messageID);
}

module.exports = { threadList, threadInfo, threadHistory };
