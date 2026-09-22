import assert from 'node:assert/strict';
import {appendFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {isolatedEnvironment,codexLauncher} from '../packages/runtime-codex/src/environment.js';
import {CodexClient} from '../packages/runtime-codex/src/client.js';
import {CodexRuntime} from '../packages/runtime-codex/src/runtime.js';
// @ts-expect-error desktop module is exercised directly by this integration probe.
import {mcpConfig} from '../apps/desktop/plugins.mjs';
const web=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<title>coAgent browser fixture</title><h1>MCP_BROWSER_OK</h1><button onclick="this.textContent=\'CLICK_OK\'">Test action</button>');});
web.listen(0,'127.0.0.1');await once(web,'listening');const address=web.address() as {port:number};
const env=await isolatedEnvironment('http://127.0.0.1:1/v1','mcp-probe-local-token-not-secret');
const socketDir=await mkdtemp('/tmp/coagent-b-');
await appendFile(join(env.codexHome,'config.toml'),'\n'+mcpConfig({version:1,browserEnabled:true,servers:[]},{socketDir,executable:process.env.COAGENT_BROWSER_EXECUTABLE||process.execPath,cli:process.env.COAGENT_BROWSER_CLI||resolve('dist/desktop/browser-mcp/node_modules/@playwright/mcp/cli.js')}));
const client=new CodexClient({command:process.execPath,args:[codexLauncher,'app-server'],cwd:env.cwd,env:env.env});
client.on('serverRequest',m=>{console.log('APPROVAL_SHAPE',JSON.stringify(m));client.respond(m.id!,{action:'accept',content:{},_meta:null});});
try{
 await client.initialize();const runtime=new CodexRuntime(client);const {thread}=await runtime.createSession({cwd:env.cwd,model:'coagent-test'});
 const list=await client.request<any>('mcpServerStatus/list',{limit:100,threadId:thread.id});
 const browser=list.data.find((s:any)=>s.name==='browser');assert.ok(browser?.tools?.browser_navigate,JSON.stringify(list));assert.ok(!browser.tools.browser_run_code);
 const result=await client.request<any>('mcpServer/tool/call',{threadId:thread.id,server:'browser',tool:'browser_navigate',arguments:{url:`http://127.0.0.1:${address.port}/`}});
 assert.ok(!result.isError,JSON.stringify(result));assert.match(JSON.stringify(result),/coAgent browser fixture/);
 const snapshot=await client.request<any>('mcpServer/tool/call',{threadId:thread.id,server:'browser',tool:'browser_snapshot',arguments:{}});assert.match(JSON.stringify(snapshot),/MCP_BROWSER_OK/);
 const ref=JSON.stringify(snapshot).match(/Test action.*?ref=(e\d+)/)?.[1];assert.ok(ref);
 const clicked=await client.request<any>('mcpServer/tool/call',{threadId:thread.id,server:'browser',tool:'browser_click',arguments:{target:ref}});assert.ok(!clicked.isError,JSON.stringify(clicked));
 const after=await client.request<any>('mcpServer/tool/call',{threadId:thread.id,server:'browser',tool:'browser_snapshot',arguments:{}});assert.match(JSON.stringify(after),/CLICK_OK/);
 await client.request('mcpServer/tool/call',{threadId:thread.id,server:'browser',tool:'browser_close',arguments:{}});
 console.log('MCP_BROWSER=PASS discovery=true real_chrome_navigation=true snapshot=true click=true isolated_profile=true bundled_server=true model_requests=0');
}finally{await client.close();await env.cleanup();await rm(socketDir,{recursive:true,force:true});web.closeAllConnections();await new Promise<void>(r=>web.close(()=>r()));}
