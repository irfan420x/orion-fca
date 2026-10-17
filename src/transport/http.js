'use strict';
/* HTTP transport — browser-faithful requests to Facebook.
 * The full desktop-Chrome header set is what separates HTTP 200 from HTTP 400.
 */

const { fromFacebook, FcaError } = require('../core/errors');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'cache-control': 'max-age=0',
};

const jazoest = (s) => '2' + [...s].reduce((n, c) => n + c.charCodeAt(0), 0);
const pick = (html, patterns) => {
  for (const re of patterns) { const m = html.match(re); if (m) return m[1]; }
  return null;
};

const TOKEN_PATTERNS = {
  dtsg: [/"DTSGInitData"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/, /"fb_dtsg"\s*:\s*"([^"]+)"/],
  lsd: [/"LSD"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/, /"lsd"\s*:\s*"([^"]+)"/],
  rev: [/"__spin_r"\s*:\s*(\d+)/],
  hsi: [/"hsi"\s*:\s*"(\d+)"/],
  hs: [/"__hs"\s*:\s*"([^"]+)"/],
};

class Http {
  constructor(client) { this.c = client; this.timeoutMs = client.options && client.options.httpTimeoutMs ? client.options.httpTimeoutMs : 20000; }

  headers(extra = {}) { return { ...HEADERS, cookie: this.c.cookie, ...extra }; }

  async get(url) {
    try {
      const r = await fetch(url, { headers: this.headers(), redirect: 'follow', signal: AbortSignal.timeout(this.timeoutMs) });
      return { status: r.status, url: r.url, text: await r.text() };
    } catch (e) {
      throw new FcaError(e && e.name === 'TimeoutError' ? 'HTTP_TIMEOUT' : 'HTTP_ERROR', `GET ${url} failed: ${e && e.message ? e.message : e}`);
    }
  }

  /** Bootstrap the per-page Relay tokens. */
  async bootstrap() {
    const page = await this.get('https://www.facebook.com/messages/t/');
    const tk = {};
    for (const [key, patterns] of Object.entries(TOKEN_PATTERNS)) tk[key] = pick(page.text, patterns);
    if (!tk.dtsg) throw new FcaError('LOGIN_FAILED', `no fb_dtsg in the messages page (HTTP ${page.status})`);
    tk.rev = tk.rev || '0';
    tk.hsi = tk.hsi || '0';
    tk.hs = tk.hs || '';
    this.c.tokens = tk;
    return tk;
  }

  _form(extra) {
    const t = this.c.tokens;
    return new URLSearchParams({
      av: this.c.userID, __user: this.c.userID, __a: '1', __req: '1', __hs: t.hs,
      __ccg: 'EXCELLENT', __rev: t.rev, __hsi: t.hsi, __comet_req: '15',
      lsd: t.lsd, jazoest: jazoest(t.dtsg), fb_dtsg: t.dtsg,
      __spin_r: t.rev, __spin_b: 'trunk', __spin_t: String(Math.floor(Date.now() / 1000)),
      ...extra,
    });
  }

  async _post(url, form, name) {
    const r = await fetch(url, {
      method: 'POST',
      headers: this.headers({
        accept: '*/*',
        'content-type': 'application/x-www-form-urlencoded',
        'x-requested-with': 'XMLHttpRequest',
        'x-fb-lsd': this.c.tokens.lsd,
        'x-asbd-id': '129477',
        'x-fb-friendly-name': name || 'query',
        origin: 'https://www.facebook.com',
        referer: 'https://www.facebook.com/messages/t/',
        'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin',
      }),
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    })
      .catch((e) => {
        throw new FcaError(e && e.name === 'TimeoutError' ? 'HTTP_TIMEOUT' : 'HTTP_ERROR', `POST failed: ${e && e.message ? e.message : e}`);
      });
    const raw = (await r.text()).replace(/^for\s*\(;;\);/, '');
    if (r.status >= 500) throw new FcaError('HTTP_ERROR', `HTTP ${r.status} from ${url}`);
    return { status: r.status, raw };
  }

  /** Single Relay query (doc_id + variables). */
  async graphql(docId, variables, name) {
    const { raw } = await this._post('https://www.facebook.com/api/graphql/', this._form({ doc_id: docId, variables: JSON.stringify(variables) }), name);
    let json;
    try { json = JSON.parse(raw); } catch { json = null; }
    if (!json) throw new FcaError('BAD_RESPONSE', `non-JSON reply: ${raw.slice(0, 120)}`);
    if (json.error) throw fromFacebook(json.error, json.errorSummary);
    const body = json.o0 || json;
    if (body.errors) throw new FcaError('GRAPHQL_ERROR', JSON.stringify(body.errors).slice(0, 200));
    return body.data || body;
  }

  /** Batch Relay query (queries={o0:{doc_id,query_params}}). */
  async batch(queries, name) {
    const { raw } = await this._post('https://www.facebook.com/api/graphqlbatch/', this._form({ queries: JSON.stringify(queries) }), name);
    const objects = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try { objects.push(JSON.parse(t)); } catch { /* partial line */ }
    }
    if (!objects.length) throw new FcaError('BAD_RESPONSE', 'empty batch reply');
    const failed = objects.find((o) => o.error);
    if (failed) throw fromFacebook(failed.error, failed.errorSummary);
    return objects;
  }
}

module.exports = { Http, HEADERS, UA };
