import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGateway } from '../../packages/model-gateway/src/server.js';
import { readSse } from '../../packages/model-gateway/src/sse.js';
import type { Obj } from '../../packages/model-gateway/src/chat-adapter.js';
import { testServer } from '../helpers/http.js';

test('Chat bridge round trip: tool arguments, real file result, final answer (scripted driver)', async t => {
  const root = await mkdtemp(join(tmpdir(), 'coagent-chat-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'input.txt'), 'chat fixture\n');
  let calls = 0;
  const upstream = await testServer((body, _req, res) => {
    const messages = body.messages as Obj[];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta: Obj, finish_reason: string | null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    if (calls++ === 0) {
      assert.equal(messages.at(-1)?.content, 'Read the fixture');
      res.end(chunk({ tool_calls: [{ index: 0, id: 'read-1', function: { name: 'read_fixture', arguments: '{}' } }] }, 'tool_calls') + 'data: [DONE]\n\n');
    } else {
      assert.equal(messages.at(-1)?.tool_call_id, 'read-1');
      assert.equal(messages.at(-1)?.content, 'chat fixture\n');
      res.end(chunk({ content: 'Fixture read successfully.' }, 'stop') + 'data: [DONE]\n\n');
    }
  }); t.after(() => upstream.close());
  const token = 'chat-loop-test-token-0123456789';
  const gateway = await startGateway({ token, provider: { protocol: 'chat-completions', baseUrl: upstream.baseUrl, alias: 'test', upstreamModel: 'scripted' } });
  t.after(() => gateway.close());
  const input: Obj[] = [{ role: 'user', content: 'Read the fixture' }];
  const invoke = async () => {
    const res = await fetch(gateway.baseUrl + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ model: 'test', stream: true, input, tools: [{ type: 'function', name: 'read_fixture', parameters: { type: 'object', properties: {} } }] }) });
    assert.equal(res.status, 200);
    const events: Obj[] = [];
    for await (const data of readSse(res.body!)) events.push(JSON.parse(data));
    assert.equal(events.at(-1)?.type, 'response.completed');
    return (events.at(-1)?.response as Obj).output as Obj[];
  };
  const first = await invoke();
  assert.equal(first[0]?.name, 'read_fixture');
  input.push(...first, { type: 'function_call_output', call_id: first[0]?.call_id, output: await readFile(join(root, 'input.txt'), 'utf8') });
  const final = await invoke();
  assert.equal((final[0]?.content as Obj[])[0]?.text, 'Fixture read successfully.');
  assert.equal(calls, 2);
  console.log('CHAT_BRIDGE_FIXTURE=PASS driver=scripted real_model=false codex_full_loop=false');
});
