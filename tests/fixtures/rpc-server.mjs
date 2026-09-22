import readline from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
let initialized = false;
for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (!message.method) { send({ method: 'approval/resolved', params: message }); continue; }
  const { id, method, params } = message;
  if (method === 'initialize') { send({ id, result: { userAgent: 'fake-codex' } }); continue; }
  if (method === 'initialized') { initialized = true; continue; }
  if (!initialized) { send({ id, error: { code: -1, message: 'Not initialized' } }); continue; }
  if (method === 'echo') send({ id, result: params });
  if (method === 'reject') send({ id, error: { code: -42, message: 'Test rejection' } });
  if (method === 'hang') continue;
  if (method === 'crash') process.exit(7);
  if (method === 'malformed') process.stdout.write('{broken\n');
  if (method === 'oversized') process.stdout.write('x'.repeat(4096));
  if (method === 'approval') {
    send({ id, result: {} });
    send({ id: 'server-1', method: 'item/commandExecution/requestApproval', params: { command: 'echo test' } });
  }
}
