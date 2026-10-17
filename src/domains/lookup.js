'use strict';
/* lookup — resolve one message id to its author.
 *
 * A reply always points at a message older than this process, so the delta
 * alone cannot attribute it. Facebook answers the pair
 * (thread_id, message_id) with the full message, including the sender —
 * the same route the classic clients use (doc 2848441488556444).
 */

const MESSAGE_INFO_DOC = '2848441488556444';

module.exports = (ctx) => {
  const { client } = ctx;

  const UA = require('../transport/http').UA;

  /** Turn a profile link into a uid. Numeric input passes through.
   *  Only shapes Facebook actually exposes without a token are accepted —
   *  a vanity handle cannot be resolved reliably, so it is refused rather
   *  than guessed at. */
  async function resolveUserID(input) {
    const raw = String(input || '').trim();
    if (/^\d{6,}$/.test(raw)) return raw;

    const patterns = [
      /[?&]id=(\d{6,})/,
      /\/profile\/(\d{6,})/,
      /facebook\.com\/(\d{6,})/,
    ];
    for (const re of patterns) {
      const hit = raw.match(re);
      if (hit) return hit[1];
    }
    return null;
  }

  return {
    resolveUserID(userInput, callback) {
      return ctx.nodeify(resolveUserID(userInput), callback);
    },

    getMessageInfo(threadID, messageID, callback) {
      return ctx.nodeify((async () => {
        const [obj] = await client.http.batch({
          o0: {
            doc_id: MESSAGE_INFO_DOC,
            query_params: {
              thread_and_message_id: {
                thread_id: String(threadID),
                message_id: String(messageID),
              },
            },
          },
        }, 'MessageInfoQuery');

        const data = (obj && obj.o0 && obj.o0.data) || {};
        const msg = data.message || {};

        // Facebook keeps the reply target inside the message itself:
        //   replied_to.status === 'VALID' → replied_to.message is the parent
        let repliedTo = null;
        const r = msg.replied_to_message || msg.replied_to;
        if (r && (r.status === 'VALID' || r.message) && r.message) {
          repliedTo = {
            messageID: String(r.message.message_id || ''),
            senderID: String((r.message.message_sender && r.message.message_sender.id) || ''),
            body: String((r.message.message && r.message.message.text) || ''),
            timestamp: String(r.message.timestamp_precise || ''),
          };
        }

        // reactions ride on the message, and the sync stream never sends them
        const reactions = (Array.isArray(msg.message_reactions) ? msg.message_reactions : []).map((r) => ({
          userID: String((r.user && r.user.id) || r.userID || ''),
          reaction: String(r.reaction || ''),
        })).filter((r) => r.userID);

        return {
          messageID: String(msg.message_id || messageID),
          reactions,
          senderID: String((msg.message_sender && msg.message_sender.id) || ''),
          body: String((msg.message && msg.message.text) || ''),
          timestamp: String(msg.timestamp_precise || msg.timestamp || ''),
          repliedTo,
          repliedRaw: r ? { status: r.status, hasMessage: Boolean(r.message) } : null,
        };
      })(), callback);
    },
  };
};
