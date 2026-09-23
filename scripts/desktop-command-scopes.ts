import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { testServer, sendResponse, assistant } from '../tests/helpers/http.js';
const root=await mkdtemp(join(tmpdir(),'coagent-approval-'));
const workspace=join(root,'workspace'),userData=join(root,'user');await mkdir(workspace);await mkdir(userData);await writeFile(join(userData,'settings.json'),JSON.stringify({workspace}));
let step=0;
const upstream=await testServer((body,req,res)=>{
 if(req.url!='/v1/responses'){res.writeHead(404);res.end();return;}
 assert.equal(body.model,'deepseek-chat');
 const n=step++;
 if([0,1,2,4].includes(n))sendResponse(res,{type:'function_call',id:`fc_${n}`,call_id:`call_${n}`,name:'exec_command',arguments:JSON.stringify({cmd:n===2?"printf 'OTHER\\n' >> approval.txt":"printf 'SAME\\n' >> approval.txt",sandbox_permissions:'require_escalated',justification:'Command scope fixture'}),status:'completed'});
 else sendResponse(res,assistant('Fixture completed.'));
});
const app=await electron.launch({args:[resolve('dist/desktop/main.mjs')],env:{...process.env,DEEPSEEK_API_KEY:'fixture-not-a-real-key',COAGENT_TEST_BASE_URL:upstream.baseUrl,COAGENT_TEST_USER_DATA:userData}});
try{
 const page=await app.firstWindow();await page.waitForSelector('h1');
 await page.evaluate(()=>Promise.all(Array.from({length:5},()=>((window as any).coagent.call('list')))));
 assert.equal(await page.getByRole('alert').count(),0);
 await page.evaluate(()=>{(window as any).commandScopeEvents=[];(window as any).coagent.subscribe((e:any)=>{if(e.method==='command/auto-approved')(window as any).commandScopeEvents.push(e);});});
 const run=async()=>{await page.getByRole('button',{name:'＋ 新建任务'}).click();await page.getByRole('textbox',{name:'任务描述'}).fill('Run command scope fixture.');await page.getByRole('button',{name:'开始任务 ↑'}).click();};
 await run();await page.locator('.approval-scope summary').click();await page.getByRole('button',{name:'本次任务允许同类命令',exact:true}).waitFor({timeout:20000});await page.getByRole('button',{name:'本次任务允许同类命令',exact:true}).click();
 const different=page.locator('.approval').filter({hasText:'OTHER'});await different.waitFor({timeout:20000});assert.equal(await readFile(join(workspace,'approval.txt'),'utf8'),'SAME\nSAME\n');
 assert.equal(await page.evaluate(()=>(window as any).commandScopeEvents.length),1);
 await different.getByRole('button',{name:'允许此次操作',exact:true}).click();await page.locator('.badge').filter({hasText:'准备就绪'}).waitFor();assert.equal(await readFile(join(workspace,'approval.txt'),'utf8'),'SAME\nSAME\nOTHER\n');
 await run();await page.locator('.approval-scope summary').click();await page.getByRole('button',{name:'本次任务允许同类命令',exact:true}).waitFor({timeout:20000});await page.getByRole('button',{name:'拒绝',exact:true}).click();await page.locator('.badge').filter({hasText:'准备就绪'}).waitFor();
 assert.equal(await readFile(join(workspace,'approval.txt'),'utf8'),'SAME\nSAME\nOTHER\n');
 console.log('COMMAND_SCOPE_UI=PASS repeated_command_auto=true changed_command_prompt=true next_task_prompt=true denial_no_effect=true real_runtime=true');
}finally{await app.close();await upstream.close();await rm(root,{recursive:true,force:true});}
