import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { CodexClient, RpcError } from '../packages/runtime-codex/src/client.js';

function client(timeout = 1500, limit = 4096) {
  return new CodexClient({ command: process.execPath, args: [resolve('tests/fixtures/rpc-server.mjs')], cwd: process.cwd(), env: {}, requestTimeoutMs: timeout, maxMessageBytes: limit });
}
test('handshake is idempotent and request/response IDs correlate', async t => {
  const rpc = client(); t.after(() => rpc.close());
  await assert.rejects(rpc.request('echo'), /Initialize/);
  await Promise.all([rpc.initialize(), rpc.initialize()]);
  assert.deepEqual(await Promise.all([rpc.request('echo', { a: 1 }), rpc.request('echo', { b: 2 })]), [{ a: 1 }, { b: 2 }]);
  assert.equal(rpc.pendingCount, 0);
});
test('RPC errors and timeouts release pending requests', async t => {
  const rpc = client(300); t.after(() => rpc.close()); await rpc.initialize();
  await assert.rejects(rpc.request('reject'), error => error instanceof RpcError && error.code === -42);
  await assert.rejects(rpc.request('hang'), /timed out/);
  assert.equal(rpc.pendingCount, 0);
});
test('server approvals are one-shot and do not collide with client requests', async t => {
  const rpc = client(); t.after(() => rpc.close()); await rpc.initialize();
  const event = once(rpc, 'serverRequest');
  await rpc.request('approval');
  const [message] = await event;
  rpc.respond(message.id, { decision: 'decline' });
  assert.throws(() => rpc.respond(message.id, { decision: 'accept' }), /already resolved/);
});
for (const mode of ['crash', 'malformed', 'oversized']) {
  test(`${mode} rejects in-flight work and clears state`, async t => {
    const rpc = client(1500, 2048); t.after(() => rpc.close()); await rpc.initialize();
    await assert.rejects(rpc.request(mode));
    assert.equal(rpc.pendingCount, 0);
    await assert.rejects(rpc.request('echo'));
  });
}
test('spawn failure is surfaced without hanging', async t => {
  const rpc = new CodexClient({ command: '/nonexistent/coagent-binary', cwd: process.cwd(), env: {} });
  t.after(() => rpc.close());
  await assert.rejects(rpc.initialize(), /ENOENT/);
});
