'use strict';
/* User reads — profile fields behind getUserInfo. */

const { DOC_IDS } = require('../protocol/endpoints');

function collectUsers(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => collectUsers(n, out));

  if (node.id && String(node.id).match(/^\d+$/) && (node.name !== undefined || node.firstName !== undefined)) {
    out[String(node.id)] = {
      userID: String(node.id),
      name: node.name || [node.firstName, node.lastName].filter(Boolean).join(' ') || null,
      firstName: node.firstName || null,
      vanity: node.username || node.vanity || null,
      profileUrl: node.url || (node.username ? `https://www.facebook.com/${node.username}` : null),
      thumbSrc: (node.big_image_src || {}).uri
        || (node.big_image || {}).uri
        || (node.profile_picture || {}).uri
        || null,
      gender: typeof node.gender === 'number' ? node.gender : null,
      isFriend: node.is_friend === true,
    };
    return;
  }
  Object.values(node).forEach((n) => collectUsers(n, out));
}

async function userInfo(client, ids) {
  const wanted = (Array.isArray(ids) ? ids : [ids]).map(String);
  const objects = await client.http.batch({
    o0: { doc_id: DOC_IDS.users, query_params: { ids: wanted } },
  }, 'UsersQuery');

  const out = {};
  for (const obj of objects) collectUsers((obj.o0 || {}).data, out);
  for (const id of wanted) if (!out[id]) out[id] = { userID: id, name: null, firstName: null };
  return out;
}

module.exports = { userInfo };
