import test from 'node:test';
import assert from 'node:assert/strict';
import { chatToResponses, toChatRequest, type Obj } from '../packages/model-gateway/src/chat-adapter.js';
import { readSse } from '../packages/model-gateway/src/sse.js';
import { sseStream } from './helpers/http.js';

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> { const values = []; for await (const value of stream) values.push(value); return values; }
const delta = (value: Obj, finish: string | null = null) => ({ choices: [{ index: 0, delta: value, finish_reason: finish }] });
test('maps text roles and preserves multiple function call associations', () => {
  const body = toChatRequest({ stream: true, instructions: 'Rules', input: [
    { role: 'developer', content: [{ type: 'input_text', text: 'More rules' }] },
    { role: 'user', content: 'Read' },
    { type: 'function_call', call_id: 'a', name: 'read', arguments: '{"file":"a"}' },
    { type: 'function_call', call_id: 'b', name: 'read', arguments: '{"file":"b"}' },
    { type: 'function_call_output', call_id: 'b', output: 'B' },
    { type: 'function_call_output', call_id: 'a', output: 'A' },
  ], tools: [{ type: 'function', name: 'read', parameters: { type: 'object' } }] }, 'target');
  const messages = body.messages as Obj[];
  assert.equal(body.model, 'target');
  assert.equal(messages[1]?.role, 'system');
  assert.equal((messages[3]?.tool_calls as Obj[]).length, 2);
  assert.equal(messages[4]?.tool_call_id, 'b');
  assert.equal(messages[5]?.tool_call_id, 'a');
});
for (const [label, extra] of Object.entries({
  previousResponse: { previous_response_id: 'resp_1' },
  customTool: { tools: [{ type: 'custom', name: 'apply_patch' }] },
  strictTool: { tools: [{ type: 'function', name: 'f', strict: true }] },
  image: { input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'x' }] }] },
  reasoning: { reasoning: { effort: 'high' } },
})) {
  test(`unsupported ${label} produces an explicit compatibility error`, () => {
    assert.throws(() => toChatRequest({ input: 'hi', stream: true, ...extra }, 'target'));
  });
}
test('text streams become ordered Responses events with real usage', async () => {
  const events = await collect(chatToResponses(sseStream([
    delta({ content: '你' }), delta({ content: '好' }, 'stop'),
    { choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
  ]), 'alias'));
  assert.equal(events.filter(e => e.type === 'response.output_text.delta').map(e => e.delta).join(''), '你好');
  assert.deepEqual(events.map(e => e.sequence_number), events.map((_, i) => i));
  const response = events.at(-1)?.response as Obj;
  assert.equal(response.status, 'completed');
  assert.deepEqual(response.usage, { input_tokens: 4, output_tokens: 2, total_tokens: 6 });
});
test('split tool arguments and interleaved indices stay associated', async () => {
  const events = await collect(chatToResponses(sseStream([
    delta({ tool_calls: [{ index: 1, id: 'b', function: { name: 'two', arguments: '{"b":' } }] }),
    delta({ tool_calls: [{ index: 0, id: 'a', function: { name: 'one', arguments: '{}' } }, { index: 1, function: { arguments: '2}' } }] }, 'tool_calls'),
  ]), 'alias'));
  const output = (events.at(-1)?.response as Obj).output as Obj[];
  assert.deepEqual(output.map(item => [item.call_id, item.arguments]), [['a', '{}'], ['b', '{"b":2}']]);
});
test('truncated stream is not reported as success', async () => {
  await assert.rejects(collect(chatToResponses(sseStream([delta({ content: 'partial' })], false), 'alias')), /terminal/);
});
test('invalid tool arguments are never emitted as executable tool calls', async () => {
  const output: Obj[] = [];
  await assert.rejects(async () => {
    for await (const event of chatToResponses(sseStream([delta({ tool_calls: [{ index: 0, id: 'a', function: { name: 'f', arguments: '{' } }] }, 'tool_calls')]), 'alias')) output.push(event);
  }, /arguments/);
  assert.equal(output.some(event => event.type === 'response.output_item.done'), false);
});
test('length stop is incomplete, not completed', async () => {
  const events = await collect(chatToResponses(sseStream([delta({ content: 'partial' }, 'length')]), 'alias'));
  assert.equal(events.at(-1)?.type, 'response.incomplete');
});
test('SSE handles split UTF-8, CRLF and multiline events', async () => {
  const bytes = new TextEncoder().encode(': comment\r\ndata: 你\r\ndata: 好\r\n\r\n');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  assert.deepEqual(await collect(readSse(stream)), ['你\n好']);
});
test('SSE rejects a partial final event', async () => {
  await assert.rejects(collect(readSse(new Response('data: incomplete').body!)), /Truncated/);
});

test('orphan and missing tool results are rejected', () => {
  assert.throws(() => toChatRequest({ stream: true, input: [{ type: 'function_call_output', call_id: 'missing', output: 'result' }] }, 'model'), /Orphan/);
  assert.throws(() => toChatRequest({ stream: true, input: [{ type: 'function_call', call_id: 'pending', name: 'f', arguments: '{}' }] }, 'model'), /Missing/);
});
test('one malformed parallel call prevents the entire tool batch from completing', async () => {
  const events: Obj[] = [];
  await assert.rejects(async () => {
    for await (const event of chatToResponses(sseStream([delta({ tool_calls: [
      { index: 0, id: 'a', function: { name: 'valid', arguments: '{}' } },
      { index: 1, id: 'b', function: { name: 'invalid', arguments: '{' } },
    ] }, 'tool_calls')]), 'alias')) events.push(event);
  }, /arguments/);
  assert.equal(events.some(event => event.type === 'response.output_item.done'), false);
});

test('empty continuation tool ID does not overwrite identity, changed nonempty ID remains rejected',async()=>{
 const events=await collect(chatToResponses(sseStream([delta({tool_calls:[{index:0,id:'call-a',function:{name:'echo',arguments:'{'}}]}),delta({tool_calls:[{index:0,id:null,function:{name:null,arguments:null}}]}),delta({tool_calls:[{index:0,id:'',function:{name:'',arguments:'}'}}]},'tool_calls')]),'test'));
 const item=events.find(e=>e.type==='response.output_item.done')!.item as Obj;
 assert.equal(item.call_id,'call-a');assert.equal(item.arguments,'{}');
 await assert.rejects(collect(chatToResponses(sseStream([delta({tool_calls:[{index:0,id:'a',function:{name:'echo',arguments:'{'}}]}),delta({tool_calls:[{index:0,id:'b',function:{arguments:'}'}}]},'tool_calls')]),'test')),/ID changed/);
});

test('explicit Qwen tool-stop compatibility still validates complete JSON and terminal markers',async()=>{
 const wire=[delta({tool_calls:[{index:0,id:'qwen',function:{name:'echo',arguments:'{}'}}]},'stop')];
 await assert.rejects(collect(chatToResponses(sseStream(wire),'test')),/Incomplete tool/);
 const result=await collect(chatToResponses(sseStream(wire),'test',{allowToolStop:true}));
 assert.equal(result.at(-1)!.type,'response.completed');
 await assert.rejects(collect(chatToResponses(sseStream([delta({tool_calls:[{index:0,id:'q',function:{name:'echo',arguments:'{'}}]},'stop')]),'test',{allowToolStop:true})),/Invalid completed/);
 await assert.rejects(collect(chatToResponses(sseStream(wire,false),'test',{allowToolStop:true})),/terminal markers/);
});
