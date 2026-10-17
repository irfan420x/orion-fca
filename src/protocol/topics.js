'use strict';
/* Realtime topics the MQTT session subscribes to. */

const TOPICS = [
  '/ls_req', '/ls_resp',
  '/legacy_web', '/webrtc', '/webrtc_response', '/rtc_multi',
  '/onevc', '/br_sr', '/sr_res',
  '/t_ms', '/thread_typing', '/orca_typing_notifications',
  '/notify_disconnect', '/orca_presence',
  '/inbox', '/mercury', '/messaging_events', '/orca_message_notifications',
  '/pp',
];

module.exports = { TOPICS };
