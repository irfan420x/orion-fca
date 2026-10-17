'use strict';
/* diagnostics — runtime introspection.
 * Added as a single file; nothing else in the library was touched. */

module.exports = (ctx) => ({
  capabilities() {
    return ctx.policy.describe();
  },
  ledgerStats() {
    return ctx.ledger.stats();
  },
  outboxStats() {
    return ctx.outbox.stats();
  },
  async selfCheck() {
    const started = Date.now();
    const { seq, threads } = await require('../queries/threads').threadList(ctx.client, 1);
    return {
      userID: ctx.client.userID,
      threads: threads.length,
      syncSequence: seq,
      latencyMs: Date.now() - started,
      ledger: ctx.ledger.stats(),
      outbox: ctx.outbox.stats(),
    };
  },
});
