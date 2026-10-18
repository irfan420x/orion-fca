'use strict';
/* upload — push a file to Facebook and get an attachment id back.
 *
 * Messenger still uses the classic mercury uploader: multipart POST to
 * /ajax/mercury/upload.php with the file in the `farr` field, authenticated by
 * the session cookie and the lsd token. The response is JSON behind an
 * `for (;;);` prefix and carries metadata[0].fbid (images) or .file_id.
 */

const fs = require('fs');
const path = require('path');
const { UA } = require('./http');
const { FcaError } = require('../core/errors');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.json': 'application/json',
};

function guessType(name) {
  return MIME[path.extname(String(name)).toLowerCase()] || 'application/octet-stream';
}

function clean(text) {
  const body = String(text || '').replace(/^for\s*\(;;\);/, '');
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Pull the ids out of whatever shape the uploader returns. */
function idsFrom(data) {
  const raw = (data && data.payload && data.payload.metadata) || [];
  const meta = Array.isArray(raw) ? raw : Object.values(raw);
  const ids = [];
  for (const m of meta) {
    const id = m.fbid || m.file_id || m.image_id || (m.extra && m.extra.fbid);
    if (id) ids.push(String(id));
  }
  if (!ids.length && data && data.payload && data.payload.fbid) ids.push(String(data.payload.fbid));
  return ids;
}

async function uploadFile(client, input) {
  const tokens = client.tokens || {};
  if (!tokens.lsd) throw new FcaError('NO_TOKEN', 'lsd token missing — login first');

  let buffer;
  let filename;
  let contentType;

  if (typeof input === 'string') {
    buffer = fs.readFileSync(input);
    filename = path.basename(input);
    contentType = guessType(filename);
  } else if (Buffer.isBuffer(input)) {
    buffer = input;
    filename = 'upload.bin';
    contentType = guessType(filename);
  } else if (input && typeof input.pipe === 'function') {
    // a stream (GoatBot hands us one) must be drained, not read as .buffer
    const chunks = [];
    for await (const chunk of input) chunks.push(Buffer.from(chunk));
    buffer = Buffer.concat(chunks);
    filename = input.filename || 'upload.jpg';
    contentType = input.contentType || guessType(filename);
  } else {
    buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.data || '');
    filename = input.filename || 'upload.bin';
    contentType = input.contentType || guessType(filename);
  }

  const req = Math.floor(Math.random() * 36 ** 2).toString(36);
  const spinT = String(Math.floor(Date.now() / 1000));
  const url = 'https://www.facebook.com/ajax/mercury/upload.php'
    + `?__user=${encodeURIComponent(client.userID)}&__a=1&dpr=1&__req=${req}`
    + `&__spin_r=${encodeURIComponent(tokens.rev || '0')}&__spin_t=${spinT}`
    + `&__rev=${encodeURIComponent(tokens.rev || '0')}&__spin_b=trunk&__comet_req=15`;

  const form = new FormData();
  // the uploader wants the session tokens in the multipart body, not the query
  form.append('av', String(client.userID));
  form.append('__user', String(client.userID));
  form.append('fb_dtsg', String(tokens.dtsg || ''));
  form.append('jazoest', '2' + [...String(tokens.dtsg || '')].reduce((a, ch) => a + ch.charCodeAt(0), 0));
  form.append('lsd', String(tokens.lsd || ''));
  form.append('__req', req);
  form.append('farr', new Blob([buffer], { type: contentType }), filename);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Cookie: client.cookie,
      'User-Agent': UA,
      Accept: '*/*',
      Origin: 'https://www.facebook.com',
      Referer: 'https://www.facebook.com/',
      'x-asbd-id': '359341',
      'x-fb-lsd': tokens.lsd,
      'x-fb-friendly-name': 'MercuryUpload',
      'x-fb-rlafr': '0',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    },
    body: form,
  });

  const text = await res.text();
  const data = clean(text);

  if (data && data.error) {
    throw new FcaError('UPLOAD_FAILED', String(data.errorSummary || data.error));
  }

  const ids = idsFrom(data);
  if (!ids.length) {
    throw new FcaError('UPLOAD_FAILED', `no id in upload response (HTTP ${res.status})`);
  }

  return { ids, raw: data, status: res.status };
}

module.exports = { uploadFile, guessType };
