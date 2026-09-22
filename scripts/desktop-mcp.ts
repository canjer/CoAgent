import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {testServer} from '../tests/helpers/http.js';
import type {Obj} from '../packages/model-gateway/src/chat-adapter.js';
const root=await mkdtemp(join(tmpdir(),'coagent-desktop-mcp-')),workspace=join(root,'workspace');await mkdir(workspace);let calls=0;
const server=await testServer((body,_req,res)=>{
 const tool=(body.tools as Obj[]).map(t=>t.function as Obj).find(t=>String(t.description).includes('mcp__fixture.echo'));
 const delta=calls++===0?{tool_calls:[{index:0,id:'ui_call',function:{name:tool?.name,arguments:'{"value":"desktop"}'}}]}:{content:'DESKTOP_MCP_DONE'};
 if(calls>1)assert.match(JSON.stringify(body.messages),/MCP_ECHO:desktop/);
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:calls===1?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
});
const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>typeof e[1]==='string'));env.COAGENT_TEST_USER_DATA=join(root,'user');delete env.DEEPSEEK_API_KEY;delete env.QWEN_API_KEY;
const app=await electron.launch({args:[resolve('dist/desktop/main.mjs')],env});
try{
 const page=await app.firstWindow();await page.waitForSelector('h1');
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},workspace);
 const status=await page.evaluate(baseUrl=>(window as any).coagent.call('providers:save',{label:'MCP Fixture',baseUrl,protocol:'chat-completions',apiStyle:'openai',upstreamModel:'fixture',apiKey:'fixture-only'}),server.baseUrl);
 const id=status.models.find((m:any)=>m.custom).id;
 await page.evaluate(id=>(window as any).coagent.call('model',{id}),id);
 await page.evaluate(server=>(window as any).coagent.call('plugins:save',{version:1,browserEnabled:false,servers:[server]}),{id:'fixture',transport:'stdio',enabled:true,command:process.execPath,args:[resolve('tests/helpers/mcp-fixture.mjs')]});
 await page.reload();await page.waitForSelector('h1');await page.locator('button.workspace').click();
 await page.getByLabel('任务描述').fill('Use the fixture echo tool.');await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='开始任务 ↑'&&!b.disabled));await page.getByLabel('任务描述').press('Enter');await page.getByRole('button',{name:'允许此次操作',exact:true}).waitFor({timeout:30000});
 await assert.rejects(page.evaluate(()=>(window as any).coagent.call('plugins:save',{version:1,browserEnabled:false,servers:[]})),/请等待/);
 await page.screenshot({path:'.verification/plugins-mcp-approval.png'});await page.getByRole('button',{name:'允许此次操作',exact:true}).click();await page.getByText('DESKTOP_MCP_DONE',{exact:true}).waitFor();assert.equal(calls,2);
 assert.ok(await page.getByText('◇ fixture / echo · completed',{exact:false}).count());
 console.log('DESKTOP_MCP_AGENT=PASS chat_namespace=true approval_ui=true tool_result=true busy_guard=true enter_submit=true');
}finally{await app.close();await server.close();await rm(root,{recursive:true,force:true});}
