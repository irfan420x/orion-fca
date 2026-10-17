'use strict';
/* One protocol registry per concern — the only place a constant ever lives. */

/** Relay query/mutation document ids. */
const DOC_IDS = {
  threadList: '3336396659757871',
  threadInfo: '3449967031715030',
  threadHistory: '1498317363570230',
  message: '1768656253222505',
  users: '5009315269112105',
  avatar: '5066134240065849',
};

/** /ls_req task labels — the numeric verb Facebook routes on. */
const TASK_LABELS = {
  sendMessage: '46',
  markRead: '21',
  reaction: '29',
  editMessage: '742',
  unsend: '33',
  deleteThread: '146',
  addUsers: '23',
  removeUser: '140',
  nickname: '44',
  title: '32',
  adminStatus: '25',
  emoji: '100003',
  theme: '43',
  threadImage: '37',
};

/** Task version ids — Facebook validates these alongside the label. */
const TASK_VERSIONS = {
  default: '8798795233522156',
  addUsers: '24502707779384158',
  removeUser: '25002366262773827',
  sendMessage: '24804310205905615',
};

const APP_ID = '2220391788200892';

module.exports = { DOC_IDS, TASK_LABELS, TASK_VERSIONS, APP_ID };
