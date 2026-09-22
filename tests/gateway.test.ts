import test from 'node:test';
import assert from 'node:assert/strict';
import { startGateway } from '../packages/model-gateway/src/server.js';
import { testServer, sendResponse, assistant } from './helpers/http.js';
import { classifyProviderStatus } from '../packages/model-gateway/src/provider-error.js';

test('payment and authentication errors are non-retryable', () => {
  assert.deepEqual(classifyProviderStatus(402), { code: 'provider_payment_required', httpStatus: 402, retryable: false });
  assert.equal(classifyProviderStatus(401).retryable, false);
  assert.equal(classifyProviderStatus(429).retryable, true);
  assert.equal(classifyProviderStatus(503).retryable, true);
});

test('HTTP 402 is preserved, classified, not retried and does not leak provider details', async t => {
  const diagnostics: string[] = [];
  const upstream = await testServer((_, __, res) => { res.writeHead(402); res.end('private-billing-data'); });
  t.after(() => upstream.close());
  const gateway = await startGateway({ token, onDiagnostic: event => diagnostics.push(event), provider: { protocol: 'responses', baseUrl: upstream.baseUrl, alias: 'local', upstreamModel: 'upstream' } });
  t.after(() => gateway.close());
  const result = await fetch(gateway.baseUrl + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: '{"model":"local"}' });
  assert.equal(result.status, 402);
  const body = await result.json() as { error: { code: string; retryable: boolean } };
  assert.equal(body.error.code, 'provider_payment_required');
  assert.equal(body.error.retryable, false);
  assert.doesNotMatch(JSON.stringify(body), /private-billing-data/);
  assert.ok(diagnostics.includes('upstream-status:402'));
  assert.equal(upstream.requests.length, 1);
});

const token = 'local-test-token-01234567890123456789';
test('Responses gateway remaps alias and does not forward local credentials', async t => {
  const upstream = await testServer((body, req, res) => {
    assert.equal(body.model, 'upstream');
    assert.equal(req.headers.authorization, 'Bearer upstream-secret');
    sendResponse(res, assistant('hello'));
  });
  t.after(() => upstream.close());
  const gateway = await startGateway({ token, provider: { protocol: 'responses', baseUrl: upstream.baseUrl, apiKey: 'upstream-secret', upstreamModel: 'upstream', alias: 'local' } });
  t.after(() => gateway.close());
  const result = await fetch(gateway.baseUrl + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ model: 'local', input: 'hi', stream: true }) });
  assert.equal(result.status, 200); assert.match(await result.text(), /response.completed/);
});
test('gateway validates token, Origin, path and model before calling upstream', async t => {
  const upstream = await testServer((_, __, res) => { res.end(); }); t.after(() => upstream.close());
  const gateway = await startGateway({ token, provider: { protocol: 'responses', baseUrl: upstream.baseUrl, upstreamModel: 'upstream', alias: 'local' } }); t.after(() => gateway.close());
  assert.equal((await fetch(gateway.baseUrl + '/responses')).status, 401);
  assert.equal((await fetch(gateway.baseUrl + '/responses', { headers: { authorization: 'Bearer ' + token, origin: 'https://example.com' } })).status, 401);
  assert.equal((await fetch(gateway.baseUrl + '/unknown', { headers: { authorization: 'Bearer ' + token } })).status, 404);
  assert.equal((await fetch(gateway.baseUrl + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: '{bad' })).status, 422);
  assert.equal((await fetch(gateway.baseUrl + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: '{"model":"unknown"}' })).status, 422);
  assert.equal(upstream.requests.length, 0);
});
test('provider error body is not exposed', async t => {
  const upstream = await testServer((_, __, res) => { res.writeHead(429); res.end('secret-api-key'); }); t.after(() => upstream.close());
  const gateway = await startGateway({ token, provider: { protocol: 'responses', baseUrl: upstream.baseUrl, alias: 'local', upstreamModel: 'upstream' } }); t.after(() => gateway.close());
  const result = await fetch(gateway.baseUrl + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: '{"model":"local"}' });
  assert.equal(result.status, 429); assert.doesNotMatch(await result.text(), /secret-api-key/);
});
test('Chat Completions endpoint converts to Responses stream', async t => {
  const upstream = await testServer((body, req, res) => {
    assert.equal(req.url, '/v1/chat/completions'); assert.equal(body.model, 'chat-model');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  }); t.after(() => upstream.close());
  const gateway = await startGateway({ token, provider: { protocol: 'chat-completions', baseUrl: upstream.baseUrl, alias: 'local', upstreamModel: 'chat-model' } }); t.after(() => gateway.close());
  const result = await fetch(gateway.baseUrl + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: '{"model":"local","input":"hi","stream":true}' });
  assert.equal(result.status, 200); assert.match(await result.text(), /response.completed/);
});
test('unverified fields fail before calling Chat Completions upstream', async t => {
  const upstream = await testServer((_, __, res) => { res.end(); }); t.after(() => upstream.close());
  const gateway = await startGateway({ token, provider: { protocol: 'chat-completions', baseUrl: upstream.baseUrl, alias: 'local', upstreamModel: 'chat-model' } }); t.after(() => gateway.close());
  const result = await fetch(gateway.baseUrl + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: '{"model":"local","input":"hi","stream":true,"tools":[{"type":"custom","name":"apply_patch"}]}' });
  assert.equal(result.status, 422); assert.equal(upstream.requests.length, 0);
});
test('network requests have a bounded timeout', async t => {
  const upstream = await testServer(() => {}); t.after(() => upstream.close());
  const gateway = await startGateway({ token, timeoutMs: 100, provider: { protocol: 'responses', baseUrl: upstream.baseUrl, alias: 'local', upstreamModel: 'upstream' } }); t.after(() => gateway.close());
  const result = await fetch(gateway.baseUrl + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: '{"model":"local"}' });
  assert.equal(result.status, 502); assert.match(await result.text(), /timed out/);
});
