'use strict';
/* The /ls_req envelope every mutation is wrapped in. */

const { APP_ID, TASK_VERSIONS } = require('../protocol/endpoints');

function offlineId() {
  return ((BigInt(Date.now()) << 22n) | BigInt(Math.floor(Math.random() * 4000))).toString();
}

function buildTask({ label, payload, queue, version, requestId, taskId }) {
  const epoch = (BigInt(Date.now()) << 22n).toString();
  return {
    requestId: requestId ?? Math.floor(100 + Math.random() * 900),
    content: {
      app_id: APP_ID,
      payload: JSON.stringify({
        tasks: [{
          label: String(label),
          payload: JSON.stringify(payload),
          queue_name: String(queue),
          task_id: taskId ?? Math.floor(Math.random() * 1001),
          failure_count: null,
        }],
        epoch_id: epoch,
        version_id: version || TASK_VERSIONS.default,
        data_trace_id: `#${require('crypto').randomBytes(6).toString('base64').replace(/=+$/, '')}`,
      }),
      request_id: requestId ?? Math.floor(100 + Math.random() * 900),
      type: 3,
    },
  };
}

/** Reads messageID / threadID out of a mutation ack. */
function extractAck(payload) {
  let messageID = null;
  let threadID = null;
  const walk = (n) => {
    if (!Array.isArray(n)) return;
    if (n[0] === 5 && (n[1] === 'replaceOptimsiticMessage' || n[1] === 'replaceOptimisticMessage')) messageID = String(n[3]);
    if (n[0] === 5 && n[1] === 'writeCTAIdToThreadsTable' && Array.isArray(n[2]) && n[2][0] === 19) threadID = String(n[2][1]);
    for (const child of n) walk(child);
  };
  walk((payload || {}).step);
  return { messageID, threadID };
}

module.exports = { buildTask, extractAck, offlineId };
