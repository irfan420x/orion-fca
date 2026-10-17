'use strict';
/* The /ls_req envelope every mutation is wrapped in. */

const { APP_ID, TASK_VERSIONS } = require('../protocol/endpoints');

function offlineId() {
  return ((BigInt(Date.now()) << 22n) | BigInt(Math.floor(Math.random() * 4000))).toString();
}

function buildTask({ label, payload, queue, version, requestId, taskId }) {
  const epoch = (BigInt(Date.now()) << 22n).toString();
  // one id for both the envelope and the promise, or every ack is ignored
  const rid = requestId ?? Math.floor(1e6 + Math.random() * 9e7);
  return {
    requestId: rid,
    content: {
      app_id: APP_ID,
      payload: JSON.stringify({
        tasks: [{
          label: String(label),
          payload: JSON.stringify(payload),
          queue_name: String(queue),
          task_id: taskId ?? Date.now() % 90000,
          failure_count: null,
        }],
        epoch_id: epoch,
        version_id: version || TASK_VERSIONS.default,
        data_trace_id: `#${require('crypto').randomBytes(6).toString('base64').replace(/=+$/, '')}`,
      }),
      request_id: rid,
      type: 3,
    },
  };
}

/** Any string starting with mid. in the ack — media sends report it elsewhere. */
function findMid(node, depth = 0) {
  if (!node || depth > 8) return null;
  if (typeof node === 'string') return node.startsWith('mid.') ? node : null;
  if (Array.isArray(node)) {
    for (const item of node) { const hit = findMid(item, depth + 1); if (hit) return hit; }
    return null;
  }
  if (typeof node === 'object') {
    for (const value of Object.values(node)) { const hit = findMid(value, depth + 1); if (hit) return hit; }
  }
  return null;
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
  if (!messageID) messageID = findMid(payload);
  return { messageID, threadID };
}

module.exports = { buildTask, extractAck, offlineId };
