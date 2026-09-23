import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseProvider} from '../packages/model-gateway/src/diagnostics.js';
import {testServer,sendResponse,assistant} from './helpers/http.js';
import {toChatRequest,type Obj} from '../packages/model-gateway/src/chat-adapter.js';
test('codex-text bridge handles optional summary requests, rejects actual reasoning controls',()=>{
 const input={stream:true,input:'hello',include:['reasoning.encrypted_content'],reasoning:{summary:'auto'}};
 assert.throws(()=>toChatRequest(input,'test'));
 assert.equal(toChatRequest(input,'test','codex-text').model,'test');
 assert.throws(()=>toChatRequest({...input,reasoning:{effort:'high'}},'test','codex-text'));
 assert.throws(()=>toChatRequest({...input,include:['unknown']},'test','codex-text'));
});
for(const protocol of ['responses','chat-completions'] as const)test('diagnostics validates '+protocol+' stream, tool and random continuation',async t=>{
 let n=0;
 const upstream=await testServer((body,req,res)=>{
  assert.equal(req.url,protocol==='responses'?'/v1/responses':'/v1/chat/completions');assert.equal(body.model,'fixture');assert.equal(req.headers.authorization,'Bearer fixture-key');
  let item:Obj;
  if(n++===0)item=assistant('DIAGNOSTIC_OK');
  else if(n===2)item={type:'function_call',id:'fc_diag',call_id:'call_diag',name:'diagnostic_echo',arguments:'{"value":"probe"}',status:'completed'};
  else{const history=(protocol==='responses'?body.input:body.messages) as Obj[];const tool=history.find(i=>i.type==='function_call_output'||i.role==='tool')!;item=assistant(String(tool.output??tool.content));}
  if(protocol==='responses'){sendResponse(res,item);return;}
  const delta=item.type==='function_call'?{tool_calls:[{index:0,id:item.call_id,function:{name:item.name,arguments:item.arguments}}]}:{content:((item.content as Obj[])[0]!).text};
  res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:item.type==='function_call'?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
 });t.after(()=>upstream.close());
 const result=await diagnoseProvider({protocol,baseUrl:upstream.baseUrl,alias:'diagnostic',upstreamModel:'fixture',apiKey:'fixture-key'});
 assert.equal(result.passed,true);assert.equal(n,3);assert.equal(JSON.stringify(result).includes('fixture-key'),false);
});
test('diagnostics preserves failures without provider body or fabricated continuation success',async t=>{
 const upstream=await testServer((_body,_req,res)=>{res.writeHead(401);res.end('secret-provider-body');});t.after(()=>upstream.close());
 const result=await diagnoseProvider({protocol:'chat-completions',baseUrl:upstream.baseUrl,alias:'x',upstreamModel:'fixture'});
 assert.deepEqual(result.checks.map(c=>c.status),['fail','fail','skipped']);assert.equal(result.passed,false);assert.equal(JSON.stringify(result).includes('secret-provider-body'),false);
});
test('diagnostics bounds stalled SSE requests',async t=>{
 const upstream=await testServer((_body,_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(': hanging\n\n');});t.after(()=>upstream.close());
 const start=Date.now();const result=await diagnoseProvider({protocol:'responses',baseUrl:upstream.baseUrl,alias:'x',upstreamModel:'fixture'},80);
 assert.equal(result.passed,false);assert.ok(Date.now()-start<3000);
});

import {chatProfileOptions} from '../packages/model-gateway/src/chat-profile.js';
test('Qwen text options bind exact official endpoint and model only',()=>{
 assert.deepEqual(chatProfileOptions('https://dashscope.aliyuncs.com/compatible-mode/v1','qwen3.5-flash'),{enable_thinking:false});
 assert.deepEqual(chatProfileOptions('https://other.example/v1','qwen3.5-flash'),{});
 assert.deepEqual(chatProfileOptions('https://dashscope.aliyuncs.com/compatible-mode/v1','other'),{});
});
import {isOfficialDeepSeekTextModel} from '../packages/model-gateway/src/chat-profile.js';
test('DeepSeek Flash text profile binds exact official model and endpoint',()=>{
 for(const base of ['https://api.deepseek.com','https://api.deepseek.com/v1/']){assert(isOfficialDeepSeekTextModel(base,'deepseek-flash'));assert.deepEqual(chatProfileOptions(base,'deepseek-flash'),{thinking:{type:'disabled'}});}
 for(const base of ['https://api.deepseek.com.evil.test','https://other.example','https://api.deepseek.com/other'])assert.deepEqual(chatProfileOptions(base,'deepseek-flash'),{});
 assert.deepEqual(chatProfileOptions('https://api.deepseek.com','other'),{});
});
test('DeepSeek Pro shares verified text compatibility without matching arbitrary models',()=>{
 for(const model of ['deepseek-flash','deepseek-v4-pro'])for(const base of ['https://api.deepseek.com','https://api.deepseek.com/v1/'])assert.deepEqual(chatProfileOptions(base,model),{thinking:{type:'disabled'}});
 assert.deepEqual(chatProfileOptions('https://third-party.example','deepseek-v4-pro'),{});
 assert.deepEqual(chatProfileOptions('https://api.deepseek.com','deepseek-v4-pro-unknown'),{});
});
