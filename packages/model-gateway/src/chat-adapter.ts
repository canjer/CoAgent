import { createHash, randomUUID } from 'node:crypto';
import { readSse } from './sse.js';

export class CompatibilityError extends Error {}
export type Obj = Record<string, unknown>;
export function object(value: unknown, label = 'object'): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CompatibilityError(`Expected ${label}`);
  return value as Obj;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new CompatibilityError(`Expected ${label}`);
  return value;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new CompatibilityError(`Expected ${label}`);
  return value;
}

/** Per-request reversible namespace mapping; names stay within Chat's 64-char limit. */
export function namespaceTools(input: Obj): {input:Obj; names:Map<string,{name:string;namespace:string}>} {
 const names=new Map<string,{name:string;namespace:string}>();
 const alias=(namespace:string,name:string)=>'mcp_'+createHash('sha256').update(JSON.stringify([namespace,name])).digest('hex').slice(0,48);
 const tools:Obj[]=[];
 for(const raw of array(input.tools??[],'tools')){
  const t=object(raw);
  if(t.type!=='namespace'){tools.push(t);continue;}
  const ns=text(t.name,'namespace');
  for(const rawTool of array(t.tools,'namespace tools')){
   const tool=object(rawTool);if(tool.type!=='function')throw new CompatibilityError('Only function namespace tools are supported');
   const name=text(tool.name,'tool name'),key=alias(ns,name);
   if(names.has(key))throw new CompatibilityError('Duplicate namespace tool');
   names.set(key,{name,namespace:ns});tools.push({...tool,name:key,description:`${ns}.${name}: ${tool.description??''}`});
  }
 }
 const seen=new Set<string>();for(const t of tools){const name=text(t.name,'tool name');if(seen.has(name))throw new CompatibilityError('Duplicate tool name');seen.add(name);}
 const items=typeof input.input==='string'?input.input:array(input.input,'input').map(raw=>{
  const item=object(raw);if(item.type==='function_call'&&item.namespace){const ns=text(item.namespace,'namespace'),name=text(item.name,'tool name');return {...item,name:alias(ns,name)};}return item;
 });
 let choice=input.tool_choice;
 if(choice&&typeof choice==='object'){const c=object(choice);if(c.namespace)choice={...c,name:alias(text(c.namespace,'namespace'),text(c.name,'tool name'))};}
 return {input:{...input,tools,input:items,...(choice!==undefined?{tool_choice:choice}:{})},names};
}

/** Strict S0 subset: text messages and JSON function tools. No silent multimodal/custom-tool conversion. */
export function toChatRequest(input: Obj, model: string, mode: 'strict' | 'codex-text' = 'strict'): Obj {
  // Codex requests optional reasoning summaries/encrypted output even for text models.
  // The explicit text bridge supports neither, but keeps all effort/unknown controls fail-closed.
  if(mode==='codex-text'){
    input={...input};
    if(Array.isArray(input.include)&&input.include.every(x=>x==='reasoning.encrypted_content'))input.include=[];
    if(input.reasoning){const r=object(input.reasoning);if(Object.keys(r).every(k=>k==='summary')&&[undefined,'auto','none'].includes(r.summary as string|undefined))input.reasoning={};}
  }
  const allowed = new Set(['model', 'input', 'instructions', 'tools', 'tool_choice', 'parallel_tool_calls', 'stream', 'store', 'max_output_tokens', 'temperature', 'top_p', 'metadata', 'include', 'reasoning', 'text', 'prompt_cache_key', 'client_metadata']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new CompatibilityError(`Unsupported Responses field: ${key}`);
  if (input.stream !== true) throw new CompatibilityError('S0 bridge requires stream=true');
  if (input.store === true) throw new CompatibilityError('Server-side storage is not supported');
  if (input.include !== undefined && array(input.include, 'include').length) throw new CompatibilityError('Response include extensions are not supported');
  if (input.reasoning !== undefined && Object.keys(object(input.reasoning)).length) throw new CompatibilityError('Reasoning parameters require a model-specific adapter');
  if (input.text !== undefined) {
    const config = object(input.text);
    if (Object.keys(config).some(key => key !== 'format') || (config.format && object(config.format).type !== 'text')) {
      throw new CompatibilityError('Structured output/verbosity requires a model-specific adapter');
    }
  }
  const messages: Obj[] = [];
  if (input.instructions) messages.push({ role: 'system', content: text(input.instructions, 'instructions') });
  const items = typeof input.input === 'string' ? [{ role: 'user', content: input.input }] : array(input.input, 'input');
  let calls: Obj[] = [];
  const flushCalls = () => {
    if (calls.length) messages.push({ role: 'assistant', content: null, tool_calls: calls });
    calls = [];
  };
  for (const value of items) {
    const item = object(value, 'input item');
    if (item.type === 'function_call') {
      const args = text(item.arguments, 'function arguments');
      try { JSON.parse(args); } catch { throw new CompatibilityError('Invalid function arguments JSON'); }
      calls.push({ id: text(item.call_id, 'call_id'), type: 'function', function: { name: text(item.name, 'tool name'), arguments: args } });
      continue;
    }
    flushCalls();
    if (item.type === 'function_call_output') {
      messages.push({ role: 'tool', tool_call_id: text(item.call_id, 'call_id'), content: typeof item.output==='string'?item.output:array(item.output,'tool output').map(v=>{const p=object(v);if(p.type!=='input_text'&&p.type!=='output_text')throw new CompatibilityError('Only text MCP outputs are supported');return text(p.text,'tool text');}).join('\n') });
      continue;
    }
    if (item.type && item.type !== 'message') throw new CompatibilityError(`Unsupported input item: ${item.type}`);
    const role = text(item.role, 'role');
    if (!['system', 'developer', 'user', 'assistant'].includes(role)) throw new CompatibilityError(`Unsupported role: ${role}`);
    const content = typeof item.content === 'string' ? item.content : array(item.content, 'content').map(value => {
      const part = object(value);
      if (part.type !== 'input_text' && part.type !== 'output_text') throw new CompatibilityError(`Unsupported content: ${part.type}`);
      return text(part.text, 'content text');
    }).join('\n');
    messages.push({ role: role === 'developer' ? 'system' : role, content });
  }
  flushCalls();
  // Tool history must be complete. Refuse orphan outputs or unfinished calls rather than
  // submitting ambiguous history that could cause an upstream model to repeat an action.
  const unresolved = new Set<string>();
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.tool_calls) {
      if (unresolved.size) throw new CompatibilityError('Missing previous tool results');
      for (const call of message.tool_calls as Obj[]) {
        const id = String(call.id);
        if (seen.has(id)) throw new CompatibilityError('Duplicate tool call ID');
        seen.add(id); unresolved.add(id);
      }
    } else if (message.role === 'tool') {
      if (!unresolved.delete(String(message.tool_call_id))) throw new CompatibilityError('Orphan or duplicate tool output');
    } else if (unresolved.size) throw new CompatibilityError('Missing tool results before next message');
  }
  if (unresolved.size) throw new CompatibilityError('Missing tool results');
  const tools = input.tools === undefined ? [] : array(input.tools, 'tools').map(value => {
    const tool = object(value);
    if (tool.type !== 'function') throw new CompatibilityError(`Unsupported tool type: ${tool.type}`);
    if (tool.strict === true) throw new CompatibilityError('Strict function schema requires a verified provider profile');
    return { type: 'function', function: { name: text(tool.name, 'tool name'), description: tool.description, parameters: tool.parameters ?? { type: 'object', properties: {} } } };
  });
  let choice = input.tool_choice;
  if (choice && typeof choice === 'object') {
    const selected = object(choice);
    if (selected.type !== 'function') throw new CompatibilityError('Unsupported tool choice');
    choice = { type: 'function', function: { name: text(selected.name, 'tool choice name') } };
  } else if (choice !== undefined && !['auto', 'none', 'required'].includes(String(choice))) throw new CompatibilityError('Unsupported tool choice');
  return {
    model, messages, stream: true, stream_options: { include_usage: true },
    ...(tools.length ? { tools } : {}),
    ...(choice !== undefined ? { tool_choice: choice } : {}),
    ...(input.parallel_tool_calls !== undefined ? { parallel_tool_calls: input.parallel_tool_calls } : {}),
    ...(input.max_output_tokens !== undefined ? { max_completion_tokens: input.max_output_tokens } : {}),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.top_p !== undefined ? { top_p: input.top_p } : {}),
  };
}

/** Convert text deltas immediately; emit validated tool calls only after complete arguments. */
export async function* chatToResponses(stream: ReadableStream<Uint8Array>, model: string, options: {allowToolStop?:boolean;toolNames?:Map<string,{name:string;namespace:string}>} = {}): AsyncGenerator<Obj> {
  const id = 'resp_' + randomUUID();
  const messageId = 'msg_' + randomUUID();
  const created = Math.floor(Date.now() / 1000);
  let sequence = 0;
  let outputText = '';
  let startedText = false;
  let finished: string | null = null;
  let done = false;
  let usage: Obj | undefined;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  const event = (type: string, fields: Obj = {}): Obj => ({ type, sequence_number: sequence++, ...fields });
  const response = (status: string, output: Obj[] = []): Obj => ({ id, object: 'response', created_at: created, model, status, output, ...(usage ? { usage } : {}) });
  yield event('response.created', { response: response('in_progress') });
  yield event('response.in_progress', { response: response('in_progress') });
  for await (const raw of readSse(stream)) {
    if (raw === '[DONE]') { done = true; break; }
    const chunk = object(JSON.parse(raw));
    if (chunk.error) throw new Error('Upstream returned a stream error');
    if (chunk.usage) {
      const u = object(chunk.usage);
      if (typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number') {
        usage = { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens, total_tokens: u.total_tokens ?? u.prompt_tokens + u.completion_tokens };
      }
    }
    const choices = array(chunk.choices ?? [], 'choices');
    if (choices.length > 1) throw new CompatibilityError('Only one completion choice is supported');
    if (!choices.length) continue;
    const choice = object(choices[0]);
    if (choice.index !== undefined && choice.index !== 0) throw new CompatibilityError('Unexpected completion index');
    const delta = object(choice.delta ?? {});
    if (delta.reasoning_content || delta.reasoning || delta.refusal) throw new CompatibilityError('Provider-specific reasoning/refusal delta needs an adapter');
    if (delta.content) {
      const deltaText = text(delta.content, 'text delta');
      if (finished) throw new Error('Content arrived after finish_reason');
      if (!startedText) {
        startedText = true;
        yield event('response.output_item.added', { output_index: 0, item: { id: messageId, type: 'message', role: 'assistant', status: 'in_progress', content: [] } });
        yield event('response.content_part.added', { item_id: messageId, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      }
      outputText += deltaText;
      if (Buffer.byteLength(outputText) > 4 * 1024 * 1024) throw new Error('Output text exceeds limit');
      yield event('response.output_text.delta', { item_id: messageId, output_index: 0, content_index: 0, delta: deltaText });
    }
    for (const rawCall of array(delta.tool_calls ?? [], 'tool_calls')) {
      if (finished) throw new Error('Tool delta arrived after finish_reason');
      const call = object(rawCall);
      if (!Number.isInteger(call.index) || Number(call.index) < 0 || Number(call.index) > 127) throw new CompatibilityError('Invalid tool index');
      const index = Number(call.index);
      const target = calls.get(index) ?? { id: '', name: '', arguments: '' };
      if (call.id !== undefined && call.id !== null) {
        const callId = text(call.id, 'tool call id');
        if (callId && target.id && target.id !== callId) throw new CompatibilityError('Tool call ID changed mid-stream');
        if(callId)target.id = callId;
      }
      const fn = object(call.function ?? {});
      if (fn.name !== undefined && fn.name !== null) target.name += text(fn.name, 'function name');
      if (fn.arguments !== undefined && fn.arguments !== null) target.arguments += text(fn.arguments, 'arguments delta');
      if (Buffer.byteLength(target.arguments) > 1024 * 1024) throw new Error('Tool arguments exceed limit');
      calls.set(index, target);
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) finished = text(choice.finish_reason, 'finish_reason');
  }
  if (!done || !finished) throw new Error('Upstream stream ended without terminal markers');
  if (!['stop', 'tool_calls', 'length'].includes(finished)) throw new CompatibilityError(`Unsupported finish reason: ${finished}`);
  // Official Qwen forced-function streams may terminate with stop. Still require DONE
  // and validate every identity and JSON object before any tool completion is emitted.
  if(options.allowToolStop&&calls.size&&finished==='stop')finished='tool_calls';
  if (calls.size && finished !== 'tool_calls') throw new Error('Incomplete tool call response');
  if (finished === 'tool_calls' && !calls.size) throw new Error('Missing tool calls');
  const output: Obj[] = [];
  if (startedText) {
    const content = { type: 'output_text', text: outputText, annotations: [] };
    const item = { id: messageId, type: 'message', role: 'assistant', status: finished === 'length' ? 'incomplete' : 'completed', content: [content] };
    yield event('response.output_text.done', { item_id: messageId, output_index: 0, content_index: 0, text: outputText });
    yield event('response.content_part.done', { item_id: messageId, output_index: 0, content_index: 0, part: content });
    yield event('response.output_item.done', { output_index: 0, item });
    output.push(item);
  }
  const ids = new Set<string>();
  const orderedCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]);
  // Validate the entire batch before emitting any executable tool completion.
  for (const [, call] of orderedCalls) {
    if (!call.id || !call.name || ids.has(call.id)) throw new Error('Invalid or duplicate tool identity');
    ids.add(call.id);
    try { object(JSON.parse(call.arguments)); } catch { throw new Error('Invalid completed tool arguments'); }
  }
  for (const [, call] of orderedCalls) {
    const index = output.length;
    const item = { type: 'function_call', id: 'fc_' + randomUUID(), call_id: call.id, name: options.toolNames?.get(call.name)?.name??call.name, ...(options.toolNames?.has(call.name)?{namespace:options.toolNames.get(call.name)!.namespace}:{}), arguments: call.arguments, status: 'completed' };
    yield event('response.output_item.added', { output_index: index, item: { ...item, arguments: '', status: 'in_progress' } });
    yield event('response.function_call_arguments.delta', { output_index: index, item_id: item.id, delta: call.arguments });
    yield event('response.function_call_arguments.done', { output_index: index, item_id: item.id, arguments: call.arguments });
    yield event('response.output_item.done', { output_index: index, item });
    output.push(item);
  }
  if (finished === 'length') yield event('response.incomplete', { response: { ...response('incomplete', output), incomplete_details: { reason: 'max_output_tokens' } } });
  else yield event('response.completed', { response: response('completed', output) });
}
