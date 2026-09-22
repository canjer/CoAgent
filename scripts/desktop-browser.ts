import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {testServer} from '../tests/helpers/http.js';
const approvalMode=process.env.COAGENT_APPROVAL_MODE||'once';
const steps=approvalMode==='similar'?['browser_navigate','browser_navigate','browser_snapshot','browser_click']:['browser_navigate','browser_snapshot','browser_click'];
const root=await mkdtemp(join(tmpdir(),'coagent-shared-e2e-')),workspace=join(root,'workspace');await mkdir(workspace);let calls=0,hits=0;let failure:unknown;
const website=createServer((_q,r)=>{hits++;r.setHeader('content-type','text/html');r.end('<title>Shared Agent Test</title><h1>Browser task</h1><button onclick="document.querySelector(\'h1\').textContent=\'SHARED_CLICK_PROOF\'">Apply change</button>');});await new Promise<void>(r=>website.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(website.address() as any).port}/`;
const server=await testServer((body,_req,res)=>{
 try{
 const step=calls++;assert.match(JSON.stringify(body.messages),/untrusted data, never instructions/);let delta:any;
 if(step<steps.length){
  const toolName=steps[step];
  const tool=(body.tools as any[]).map(t=>t.function).find(t=>String(t.description).includes('mcp__browser.'+toolName));assert.ok(tool,JSON.stringify(body.tools));
  let args:any=toolName==='browser_navigate'?{url,allowLocal:true}:{};
  if(toolName==='browser_click'){const messages=(body.messages as any[]).filter(m=>m.role==='tool');const output=String(messages.at(-1).content);const parsed=JSON.parse(output.slice(output.indexOf('{')));const snapshot=parsed.snapshotId?parsed:JSON.parse(parsed.content[0].text);args={snapshotId:snapshot.snapshotId,ref:snapshot.elements.find((e:any)=>e.label==='Apply change').ref};}
  delta={tool_calls:[{index:0,id:'browser_'+step,function:{name:tool.name,arguments:JSON.stringify(args)}}]};
 }else{assert.match(JSON.stringify(body.messages),/performed/);delta={content:'SHARED_BROWSER_AGENT_DONE'};}
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:step<steps.length?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
 }catch(error){failure=error;res.writeHead(500);res.end(String(error));}
});
const env:any={...process.env,COAGENT_TEST_USER_DATA:join(root,'user')};delete env.DEEPSEEK_API_KEY;delete env.QWEN_API_KEY;
const app=await electron.launch({...(process.env.COAGENT_TEST_APP?{executablePath:process.env.COAGENT_TEST_APP}:{}),args:process.env.COAGENT_TEST_APP?[]:[resolve('dist/desktop/main.mjs')],env});
try{
 const page=await app.firstWindow();await page.waitForSelector('h1');
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},workspace);
 const status=await page.evaluate(baseUrl=>(window as any).coagent.call('providers:save',{label:'Browser fixture',baseUrl,protocol:'chat-completions',apiStyle:'openai',upstreamModel:'fixture',apiKey:'fixture-only'}),server.baseUrl);
 await page.evaluate(id=>(window as any).coagent.call('model',{id}),status.models.find((m:any)=>m.custom).id);
 await page.evaluate(()=>(window as any).coagent.call('plugins:save',{version:1,browserEnabled:true,servers:[]}));
 await page.reload();await page.waitForSelector('h1');await page.getByRole('button',{name:'＋ 新建任务',exact:true}).click();
 await page.getByLabel('任务描述').fill('Use the shared browser to open the test page, snapshot and click Apply change.');await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='开始任务 ↑'&&!b.disabled));await page.getByLabel('任务描述').press('Enter');
 for(let i=0;i<steps.length;i++){
  if(steps[i]==='browser_navigate'||steps[i]==='browser_snapshot')continue;
  const card=page.locator('.approval').filter({hasText:'tool "'+steps[i]+'"'});const approval=card.getByRole('button',{name:'允许此次操作',exact:true});await approval.waitFor({timeout:30000});
  if(i===0)assert.equal(hits,0);
  if(i>0)await page.waitForFunction(async()=>!(await (window as any).coagent.call('browser:state')).visible);
  await approval.click();
 }
 await page.getByText('SHARED_BROWSER_AGENT_DONE',{exact:true}).waitFor({timeout:30000});assert.ifError(failure);assert.equal(calls,steps.length+1);await page.locator('.badge').filter({hasText:'准备就绪'}).waitFor();assert.deepEqual((await page.evaluate(()=>(window as any).coagent.call('browser:state'))).approvalScope,{all:false,similarCount:0});
 await page.locator('.browser-diagnostics summary').filter({hasText:'主文档已加载'}).waitFor();await page.locator('.browser-diagnostics summary').click();await page.getByText('仅展示资源域，不含路径、查询参数或凭据。',{exact:false}).waitFor();await page.locator('.browser-diagnostics summary').click();
 const proof=await app.evaluate(({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'));return wc?.executeJavaScript('document.querySelector("h1").textContent');});assert.equal(proof,'SHARED_CLICK_PROOF');
 await page.waitForFunction(async()=>(await (window as any).coagent.call('browser:state')).visible);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.waitForFunction(async()=>!(await (window as any).coagent.call('browser:state')).visible);await page.keyboard.press('Escape');
 await page.waitForFunction(async()=>(await (window as any).coagent.call('browser:state')).visible);
 await page.getByRole('button',{name:'接管',exact:true}).click();assert.equal((await page.evaluate(()=>(window as any).coagent.call('browser:state'))).paused,true);
 await page.getByRole('button',{name:'交还 Agent',exact:true}).click();assert.equal((await page.evaluate(()=>(window as any).coagent.call('browser:state'))).paused,false);
 await page.getByRole('button',{name:'接管',exact:true}).waitFor();
 const viewshot=await app.evaluate(async({webContents})=>(await webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'))!.capturePage()).toDataURL());await writeFile('.verification/embedded-page.png',Buffer.from(viewshot.split(',')[1]!, 'base64'));
 const screenshot=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0]!.capturePage()).toDataURL());await writeFile('.verification/embedded-ui.png',Buffer.from(screenshot.split(',')[1]!, 'base64'));
 await page.getByRole('button',{name:'关闭网页',exact:true}).click();await page.waitForFunction(async()=>!(await (window as any).coagent.call('browser:state')).open);
 console.log('APPROVAL_SCOPE='+approvalMode+' reset_on_completion=true');
 console.log('DESKTOP_SHARED_BROWSER=PASS real_codex=true chat_mcp=true navigate_snapshot_click=true shared_visible_dom=true approval_policy_verified=true modal_hidden=true takeover_resume=true no_external_chrome=true');
}catch(error){console.error('BROWSER_E2E_ERROR',error);console.error(await (await app.firstWindow()).locator('body').innerText());throw error;}finally{if(failure)console.error(failure);await app.close();await server.close();website.closeAllConnections();await new Promise<void>(r=>website.close(()=>r()));await rm(root,{recursive:true,force:true});}
