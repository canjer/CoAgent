import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {testServer} from '../helpers/http.js';
import {isolatedEnvironment,codexLauncher} from '../../packages/runtime-codex/src/environment.js';
import {CodexClient} from '../../packages/runtime-codex/src/client.js';
import {CodexRuntime} from '../../packages/runtime-codex/src/runtime.js';
import {startGateway} from '../../packages/model-gateway/src/server.js';
import type {Obj} from '../../packages/model-gateway/src/chat-adapter.js';
// @ts-expect-error Desktop module is intentionally loaded by integration tests.
import {mcpConfig} from '../../apps/desktop/plugins.mjs';
for(const transport of ['stdio','http'] as const)for(const accept of [true,false])test(`${transport} approval=${accept}: real Codex exposes MCP tools through Chat gateway and returns tool result`, {timeout:45000},async()=>{
 let calls=0;const requests:any[]=[];const approvals:any[]=[];
 const upstream=await testServer((body,_req,res)=>{
  const tools=(body.tools as Obj[]).map(t=>t.function as Obj);requests.push(tools.map(t=>t.name));
  const tool=tools.find(t=>String(t.description).includes('echo'));
  res.writeHead(200,{'content-type':'text/event-stream'});
  if(calls++===0){assert.ok(tool,JSON.stringify(requests));res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'mcp_1',function:{name:tool.name,arguments:'{"value":"proof"}'}}]},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);}
  else {if(accept)assert.match(JSON.stringify(body.messages),/MCP_ECHO:proof/);else assert.doesNotMatch(JSON.stringify(body.messages),/MCP_ECHO:proof/);res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'MCP_SUCCESS'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);}
 });
 let toolCalls=0;
 const mcp=await testServer((body,_req,res)=>{
  let result:Obj={};
  if(body.method==='initialize')result={protocolVersion:(body.params as Obj).protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture-http',version:'1'}};
  if(body.method==='tools/list')result={tools:[{name:'echo',description:'Return a test value.',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}}]};
  if(body.method==='tools/call'){toolCalls++;result={content:[{type:'text',text:'MCP_ECHO:proof'}]};}
  if(body.method==='resources/list')result={resources:[]};if(body.method==='resources/templates/list')result={resourceTemplates:[]};
  if(body.id===undefined){res.writeHead(202);res.end();return;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
 });
 const token='mcp-integration-token-no-provider-key';const gateway=await startGateway({token,provider:{protocol:'chat-completions',baseUrl:upstream.baseUrl,alias:'coagent-test',upstreamModel:'fixture'}});
 const env=await isolatedEnvironment(gateway.baseUrl,token);
 await appendFile(join(env.codexHome,'config.toml'),'\n'+mcpConfig({version:1,browserEnabled:false,servers:[transport==='stdio'?{id:'fixture',enabled:true,transport,command:process.execPath,args:[resolve('tests/helpers/mcp-fixture.mjs')]}:{id:'fixture',enabled:true,transport,url:mcp.baseUrl}]},{}));
 const client=new CodexClient({command:process.execPath,args:[codexLauncher,'app-server'],cwd:env.cwd,env:env.env});
 client.on('serverRequest',m=>{approvals.push(m);client.respond(m.id!,m.method==='mcpServer/elicitation/request'?{action:accept?'accept':'decline',content:accept?{}:null,_meta:null}:{decision:'accept'});});
 try{
 await client.initialize();const runtime=new CodexRuntime(client);const {thread}=await runtime.createSession({cwd:env.cwd,model:'coagent-test',sandbox:'workspace-write',approvalPolicy:'on-request'});
 const wait=runtime.waitForCompletion(thread.id,30000);
 try{await runtime.startTurn({threadId:thread.id,input:[{type:'text',text:'Use fixture echo with value proof.',text_elements:[]}]});const done=await wait.result;assert.equal(done.turn.status,'completed',JSON.stringify({done,requests,approvals}));}finally{wait.dispose();}
 assert.equal(calls,2,JSON.stringify(requests));assert.ok(approvals.length>0,'MCP tool approval required');
 if(transport==='http')assert.equal(toolCalls,accept?1:0);
 console.log(`MCP_CHAT_AGENT=PASS transport=${transport} accept=${accept} approval_count=${approvals.length}`);
 }finally{await client.close();await env.cleanup();await gateway.close();await upstream.close();await mcp.close();}
});
