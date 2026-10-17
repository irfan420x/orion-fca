'use strict';
/**
 * Wire contracts — the shapes that cross the public boundary.
 * Declared as JSDoc typedefs so editors get types without a build step.
 *
 * @typedef {Object} MessageEvent
 * @property {'message'} type
 * @property {string} senderID
 * @property {string} threadID
 * @property {string} messageID
 * @property {string} body
 * @property {number} timestamp
 * @property {boolean} isGroup
 * @property {string[]} participantIDs
 * @property {Array<Object>} attachments
 * @property {Object} mentions
 *
 * @typedef {Object} ReadReceiptEvent
 * @property {'read_receipt'} type
 * @property {string} threadID
 * @property {string} reader
 * @property {number} time
 *
 * @typedef {Object} TypingEvent
 * @property {'typ'} type
 * @property {string} threadID
 * @property {string} userID
 * @property {boolean} isTyping
 *
 * @typedef {MessageEvent|ReadReceiptEvent|TypingEvent} FcaEvent
 *
 * @typedef {Object} UserShape
 * @property {string} userID
 * @property {string|null} name
 * @property {string|null} firstName
 * @property {string|null} vanity
 * @property {string|null} profileUrl
 * @property {string|null} thumbSrc
 * @property {boolean} [isFriend]
 *
 * @typedef {Object} ThreadShape
 * @property {string} threadID
 * @property {string|null} threadName
 * @property {UserShape[]} userInfo
 * @property {string[]} participantIDs
 * @property {string[]} adminIDs
 * @property {boolean} isGroup
 * @property {number|null} messageCount
 *
 * @typedef {Object} SendResult
 * @property {string|null} messageID
 * @property {string} threadID
 *
 * @typedef {Object} FcaErrorShape
 * @property {string} error
 * @property {string} [code]
 */

module.exports = {};
