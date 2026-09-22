import test from 'node:test';
import assert from 'node:assert/strict';
import {namespaceTools,toChatRequest,chatToResponses,type Obj} from '../packages/model-gateway/src/chat-adapter.js';
import {sseStream} from './helpers/http.js';
const tool={type:'function',name:'echo',parameters:{type:'object'}};
const base:Obj={stream:true,input:[],tools:[{type:'namespace',name:'mcp__a',tools:[tool]},{type:'namespace',name:'mcp__b',tools:[tool]}]};
test('MCP aliases are collision-free and restore name/namespace after streaming',async()=>{
 const mapped=namespaceTools(base);const names=[...mapped.names.keys()];assert.notEqual(names[0],names[1]);assert.ok(names.every(n=>n.length<=64));
 assert.equal((toChatRequest(mapped.input,'fixture').tools as Obj[]).length,2);
 const events=[];for await(const e of chatToResponses(sseStream([{choices:[{index:0,delta:{tool_calls:[{index:0,id:'call',function:{name:names[0],arguments:'{}'}}]},finish_reason:'tool_calls'}]}]),'fixture',{toolNames:mapped.names}))events.push(e);
 const item=events.find(e=>e.type==='response.output_item.done')!.item as Obj;assert.equal(item.name,'echo');assert.equal(item.namespace,'mcp__a');
});
test('MCP history maps identities and only text output arrays are accepted',()=>{
 const input={...base,input:[{type:'function_call',call_id:'1',name:'echo',namespace:'mcp__a',arguments:'{}'},{type:'function_call_output',call_id:'1',output:[{type:'input_text',text:'proof'}]}]};
 const mapped=namespaceTools(input),messages=toChatRequest(mapped.input,'fixture').messages as Obj[];
 assert.equal(((messages[0]!.tool_calls as Obj[])[0]!.function as Obj).name,[...mapped.names.keys()][0]);assert.equal(messages[1]!.content,'proof');
 assert.throws(()=>toChatRequest({...mapped.input,input:[{type:'function_call_output',call_id:'1',output:[{type:'input_image'}]}]},'fixture'));
 assert.throws(()=>namespaceTools({...base,tools:[{type:'namespace',name:'mcp__a',tools:[tool,tool]}]}));
 assert.throws(()=>namespaceTools({...base,tools:[{type:'namespace',name:'mcp__a',tools:[{type:'custom',name:'x'}]}]}));
});
