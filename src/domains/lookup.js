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

  return {
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

        return {
          messageID: String(msg.message_id || messageID),
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
