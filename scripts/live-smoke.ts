import { getModelProfile } from '../packages/model-gateway/src/profiles.js';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CodexClient, type RpcMessage } from '../packages/runtime-codex/src/client.js';
import { CodexRuntime } from '../packages/runtime-codex/src/runtime.js';
import { codexLauncher, isolatedEnvironment } from '../packages/runtime-codex/src/environment.js';
import { startGateway } from '../packages/model-gateway/src/server.js';
import { classifyProviderStatus } from '../packages/model-gateway/src/provider-error.js';

const modelId=process.env.COAGENT_MODEL || 'deepseek-chat';
const profile = {...getModelProfile(modelId), alias:modelId, upstreamModel:modelId};
const apiKey = process.env[profile.apiKeyEnv];
if (!apiKey) {
  console.log(`LIVE_STATUS=PENDING model=${modelId} missing_environment=${profile.apiKeyEnv}`);
  process.exitCode = 2;
} else {
  const diagnostics: string[] = [];
  const token = randomBytes(32).toString('hex');
  const gateway = await startGateway({ token, onDiagnostic: event => diagnostics.push(event), timeoutMs: 90000, provider: {
    protocol: process.argv.includes('--chat')?'chat-completions':profile.protocol, baseUrl: profile.baseUrl, upstreamModel: profile.upstreamModel,
    alias: profile.alias, apiKey,
  } });
  const isolated = await isolatedEnvironment(gateway.baseUrl, token, profile.alias);
  const client = new CodexClient({ command: process.execPath, args: [codexLauncher, 'app-server'], cwd: isolated.cwd, env: isolated.env });
  const runtime = new CodexRuntime(client);
  let resumedClient: CodexClient | undefined;
  let wait: ReturnType<CodexRuntime['waitForCompletion']> | undefined;
  const interrupted = () => { void client.close(); void resumedClient?.close(); };
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  let deniedRequests = 0;
  client.on('serverRequest', (message: RpcMessage) => {
    deniedRequests++;
    client.respond(message.id!, { decision: 'decline' });
  });
  try {
    await writeFile(join(isolated.cwd, 'input.txt'), 'coAgent smoke input\n');
    await client.initialize();
    const { thread } = await runtime.createSession({
      cwd: isolated.cwd, model: profile.alias, approvalPolicy: 'on-request', sandbox: 'workspace-write',
      baseInstructions: 'You are coAgent in an isolated smoke-test workspace. Read and write only in the current directory. Do not use the network, install software, or access secrets. Complete the short user task using local tools.',
    });
    wait = runtime.waitForCompletion(thread.id, 120000);
    await runtime.startTurn({ threadId: thread.id, input: [{
      type: 'text', text_elements: [],
      text: 'Read input.txt, then create output.txt containing exactly "coAgent smoke passed" followed by a newline. Use a shell command to verify both files. End with a short summary.',
    }] });
    const result = await wait.result;
    if (result.turn.status !== 'completed') {
      const info = result.turn.error?.codexErrorInfo;
      console.error(JSON.stringify({ phase: 'turn', status: result.turn.status, code: info, diagnostics }));
    }
    assert.equal(result.turn.status, 'completed', 'Live turn did not complete');
    assert.equal(await readFile(join(isolated.cwd, 'output.txt'), 'utf8'), 'coAgent smoke passed\n');
    assert.equal(await readFile(join(isolated.cwd, 'input.txt'), 'utf8'), 'coAgent smoke input\n');
    const history = await runtime.readSession(thread.id);
    const commands = history.thread.turns.flatMap(turn => turn.items).filter(item => item.type === 'commandExecution');
    assert.ok(commands.some(command => command.status === 'completed' && command.exitCode === 0), 'No successful command execution in persisted history');
    console.log(JSON.stringify({ status: 'PASS', model: profile.upstreamModel, protocol: process.argv.includes('--chat')?'chat-completions':'responses', check: 'single-live-file-task', deniedRequests, fullAgentCertification: false }));
    if (process.argv.includes('--resume')) {
      wait.dispose();
      await client.close();
      resumedClient = new CodexClient({ command: process.execPath, args: [codexLauncher, 'app-server'], cwd: isolated.cwd, env: isolated.env });
      resumedClient.on('serverRequest', (message: RpcMessage) => {
        deniedRequests++; resumedClient!.respond(message.id!, { decision: 'decline' });
      });
      await resumedClient.initialize();
      const resumed = new CodexRuntime(resumedClient);
      const listing = await resumed.listSessions(isolated.cwd);
      assert.ok(listing.data.some(item => item.id === thread.id));
      await resumed.resumeSession(thread.id);
      const restored = await resumed.readSession(thread.id);
      assert.equal(restored.thread.turns.length, history.thread.turns.length);
      wait = resumed.waitForCompletion(thread.id, 120000);
      await resumed.startTurn({ threadId: thread.id, input: [{ type: 'text', text_elements: [], text: 'Continue this test. Read output.txt and verify it still contains exactly "coAgent smoke passed" with a newline. Create resumed.txt containing exactly "coAgent resume passed" followed by a newline. Use a shell command to verify the files. Do not change input.txt or output.txt.' }] });
      assert.equal((await wait.result).turn.status, 'completed');
      assert.equal(await readFile(join(isolated.cwd, 'resumed.txt'), 'utf8'), 'coAgent resume passed\n');
      assert.equal(await readFile(join(isolated.cwd, 'output.txt'), 'utf8'), 'coAgent smoke passed\n');
      assert.equal(await readFile(join(isolated.cwd, 'input.txt'), 'utf8'), 'coAgent smoke input\n');
      const final = await resumed.readSession(thread.id);
      assert.equal(final.thread.turns.length, history.thread.turns.length + 1);
      console.log(JSON.stringify({ status: 'PASS', model: profile.upstreamModel, protocol: process.argv.includes('--chat')?'chat-completions':'responses', check: 'live-restart-resume-followup', persistedTurns: final.thread.turns.length, deniedRequests, fullAgentCertification: false }));
    }
  } catch (error) {
    // Print classification only: runtime error bodies may contain request content.
    const lastStatus = diagnostics.filter(event => event.startsWith('upstream-status:')).at(-1);
    const httpStatus = lastStatus ? Number(lastStatus.split(':')[1]) : undefined;
    const providerError = httpStatus && httpStatus >= 400 ? classifyProviderStatus(httpStatus) : undefined;
    console.error(JSON.stringify({ status: 'FAILED', model: profile.upstreamModel, category: error instanceof Error ? error.name : 'unknown', deniedRequests, providerError }));
    process.exitCode = httpStatus === 402 ? 3 : 1;
  } finally {
    wait?.dispose();
    await resumedClient?.close(); await client.close(); await gateway.close(); await isolated.cleanup();
    process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted);
  }
}
