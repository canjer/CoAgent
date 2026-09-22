import assert from 'node:assert/strict';
import { CodexClient } from '../packages/runtime-codex/src/client.js';
import { CodexRuntime } from '../packages/runtime-codex/src/runtime.js';
import { codexLauncher, isolatedEnvironment } from '../packages/runtime-codex/src/environment.js';

const isolated = await isolatedEnvironment('http://127.0.0.1:1/v1', 'probe-not-a-real-model-credential');
const client = new CodexClient({ command: process.execPath, args: [codexLauncher, 'app-server'], cwd: isolated.cwd, env: isolated.env });
try {
  await client.initialize();
  const runtime = new CodexRuntime(client);
  const { thread } = await runtime.createSession({ cwd: isolated.cwd, model: 'coagent-test' });
  assert.ok(thread.id);
  const sessions = await runtime.listSessions(isolated.cwd);
  console.log(JSON.stringify({ status: 'PASS', check: 'real-runtime-handshake-and-thread-start', modelCalls: 0, threadCreated: Boolean(thread.id), listedThreads: sessions.data.length, isolatedHome: true }, null, 2));
} finally { await client.close(); await isolated.cleanup(); }
