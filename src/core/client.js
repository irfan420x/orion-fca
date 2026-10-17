'use strict';
/* The session object: cookies, identity, tokens, HTTP transport. */

const { Http } = require('../transport/http');
const { FcaError } = require('./errors');

class Client {
  constructor(appState, options = {}) {
    this.state = Array.isArray(appState) ? appState : JSON.parse(appState);
    this.cookie = this.state.map((c) => `${c.key}=${c.value}`).join('; ');
    this.jar = Object.fromEntries(this.state.map((c) => [c.key, c.value]));
    this.userID = this.jar.c_user;
    this.options = options;
    this.tokens = null;
    this.http = new Http(this);
  }

  async login() {
    if (!this.userID || !this.jar.xs) {
      throw new FcaError('BAD_APPSTATE', 'appState is missing c_user / xs');
    }
    await this.http.bootstrap();
    return this;
  }

  getAppState() { return this.state.map((c) => ({ ...c })); }
  getCookies() { return this.cookie; }
  setOptions(options) { this.options = { ...this.options, ...(options || {}) }; return this; }
}

module.exports = { Client };
