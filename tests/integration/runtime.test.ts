import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CodexClient, type RpcMessage } from '../../packages/runtime-codex/src/client.js';
import { CodexRuntime } from '../../packages/runtime-codex/src/runtime.js';
import { codexLauncher, isolatedEnvironment } from '../../packages/runtime-codex/src/environment.js';
import { startGateway } from '../../packages/model-gateway/src/server.js';
import { testServer, sendResponse, assistant } from '../helpers/http.js';
import type { Obj } from '../../packages/model-gateway/src/chat-adapter.js';

const token = 'integration-token-not-a-provider-key';
function connect(environment: Awaited<ReturnType<typeof isolatedEnvironment>>) {
  const client = new CodexClient({ command: process.execPath, args: [codexLauncher, 'app-server'], cwd: environment.cwd, env: environment.env });
  // Unexpected approvals fail closed. The fixture commands should stay inside workspace-write.
  client.on('serverRequest', (message: RpcMessage) => client.respond(message.id!, { decision: 'decline' }));
  return client;
}
function toolCall(tools: Obj[], command: string, step: number): Obj {
  const tool = tools.find(tool => ['exec_command', 'shell_command', 'shell'].includes(String(tool.name)));
  if (!tool) throw new Error('No supported shell tool in: ' + tools.map(tool => `${tool.type}:${tool.name}`).join(','));
  const args = tool.name === 'exec_command' ? { cmd: command, max_output_tokens: 1000 } : tool.name === 'shell_command' ? { command, timeout_ms: 10000 } : { command: ['sh', '-c', command], timeout_ms: 10000 };
  return { type: 'function_call', id: `fc_${step}`, call_id: `call_${step}`, name: tool.name, arguments: JSON.stringify(args), status: 'completed' };
}

test('real Codex + deterministic Responses provider: read/write/test, history and restart', { timeout: 60000 }, async t => {
  const cleanup: (() => Promise<void>)[] = [];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); });
  let step = 0;
  const traces: { fields: string[]; tools: string[] }[] = [];
  const upstream = await testServer((body, _req, res) => {
    const tools = (body.tools ?? []) as Obj[];
    traces.push({ fields: Object.keys(body), tools: tools.map(tool => `${tool.type}:${tool.name}`) });
    const input = body.input as Obj[];
    const outputs = input.filter(item => item.type === 'function_call_output');
    if (step === 0) sendResponse(res, toolCall(tools, 'cat input.txt', step++));
    else if (step === 1) {
      assert.match(JSON.stringify(outputs), /hello/);
      sendResponse(res, toolCall(tools, "printf 'coAgent test\\n' > output.txt; test \"$(cat input.txt)\" = hello && test \"$(cat output.txt)\" = 'coAgent test' && test -z \"$COAGENT_GATEWAY_TOKEN\" && printf 'TOOLS_OK\\n'", step++));
    } else {
      assert.match(JSON.stringify(outputs), /TOOLS_OK/);
      sendResponse(res, assistant('S0 fixture completed.'));
      step++;
    }
  }); cleanup.push(() => upstream.close());
  const gateway = await startGateway({ token, provider: { protocol: 'responses', baseUrl: upstream.baseUrl, alias: 'coagent-test', upstreamModel: 'fixture-model' } }); cleanup.push(() => gateway.close());
  const isolated = await isolatedEnvironment(gateway.baseUrl, token); cleanup.push(() => isolated.cleanup());
  await writeFile(join(isolated.cwd, 'input.txt'), 'hello\n');
  const client = connect(isolated); cleanup.push(() => client.close());
  await client.initialize();
  const runtime = new CodexRuntime(client);
  const { thread } = await runtime.createSession({ cwd: isolated.cwd, model: 'coagent-test', baseInstructions: 'You are a local fixture agent. Only work in the current directory.', sandbox: 'workspace-write', approvalPolicy: 'on-request' });
  const completion = runtime.waitForCompletion(thread.id);
  try {
    await runtime.startTurn({ threadId: thread.id, input: [{ type: 'text', text: 'Read input.txt, write output.txt and verify both.', text_elements: [] }] });
    const result = await completion.result;
    assert.equal(result.turn.status, 'completed', JSON.stringify({ error: result.turn.error, traces }));
  } finally { completion.dispose(); }
  assert.equal(await readFile(join(isolated.cwd, 'output.txt'), 'utf8'), 'coAgent test\n');
  assert.equal(step, 3);
  const snapshot = await runtime.readSession(thread.id);
  assert.ok(snapshot.thread.turns.length >= 1);
  await client.close();
  const reopened = connect(isolated); cleanup.push(() => reopened.close()); await reopened.initialize();
  const nextRuntime = new CodexRuntime(reopened);
  const list = await nextRuntime.listSessions(isolated.cwd);
  assert.ok(list.data.some(item => item.id === thread.id));
  assert.equal((await nextRuntime.resumeSession(thread.id)).thread.id, thread.id);
  const restored = await nextRuntime.readSession(thread.id);
  assert.equal(restored.thread.turns.length, snapshot.thread.turns.length);
  console.log('REAL_RUNTIME_FIXTURE: read/write/test=PASS history/restart=PASS credential_environment=PASS');
  console.log('CAPTURED_REQUEST_SHAPE: ' + JSON.stringify(traces[0]));
});

test('real Codex cancellation reaches an interrupted terminal state', { timeout: 30000 }, async t => {
  const cleanup: (() => Promise<void>)[] = [];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); });
  let observed!: () => void;
  const requestObserved = new Promise<void>(resolve => { observed = resolve; });
  const upstream = await testServer((_body, _req, res) => {
    if (_req.url !== '/v1/responses') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': waiting\n\n'); observed();
  }); cleanup.push(() => upstream.close());
  const isolated = await isolatedEnvironment(upstream.baseUrl, token); cleanup.push(() => isolated.cleanup());
  const client = connect(isolated); cleanup.push(() => client.close()); await client.initialize();
  const runtime = new CodexRuntime(client);
  const { thread } = await runtime.createSession({ cwd: isolated.cwd, model: 'coagent-test' });
  const completion = runtime.waitForCompletion(thread.id, 20000);
  try {
    const { turn } = await runtime.startTurn({ threadId: thread.id, input: [{ type: 'text', text: 'Wait.', text_elements: [] }] });
    await requestObserved;
    await runtime.interruptTurn(thread.id, turn.id);
    assert.equal((await completion.result).turn.status, 'interrupted');
  } finally { completion.dispose(); }
});
