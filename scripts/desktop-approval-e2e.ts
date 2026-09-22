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
 if(step++%2===0)sendResponse(res,{type:'function_call',id:`fc_${step}`,call_id:`call_${step}`,name:'exec_command',arguments:JSON.stringify({cmd:"printf 'APPROVED\\n' > approval.txt",sandbox_permissions:'require_escalated',justification:'Desktop approval fixture: write approval.txt'}),status:'completed'});
 else sendResponse(res,assistant('Fixture completed.'));
});
const app=await electron.launch({args:[resolve('dist/desktop/main.mjs')],env:{...process.env,DEEPSEEK_API_KEY:'fixture-not-a-real-key',COAGENT_TEST_BASE_URL:upstream.baseUrl,COAGENT_TEST_USER_DATA:userData}});
try{
 const page=await app.firstWindow();await page.waitForSelector('h1');
 await page.evaluate(()=>Promise.all(Array.from({length:5},()=>((window as any).coagent.call('list')))));
 assert.equal(await page.getByRole('alert').count(),0);
 for(const decision of ['拒绝','允许此次操作']){
  await page.getByRole('button',{name:'＋ 新建任务'}).click();
  await page.getByRole('textbox',{name:'任务描述'}).fill('Run approval fixture.');
  await page.getByRole('button',{name:'开始任务 ↑'}).click();
  await page.getByRole('button',{name:decision,exact:true}).waitFor({timeout:20000});
  await page.screenshot({path:'.verification/desktop-approval.png'});
  await page.getByRole('button',{name:decision,exact:true}).click();
  await page.getByRole('button',{name:'开始任务 ↑'}).waitFor({timeout:20000});
  if(decision==='拒绝')await assert.rejects(access(join(workspace,'approval.txt')));
  else assert.equal(await readFile(join(workspace,'approval.txt'),'utf8'),'APPROVED\n');
 }
 console.log('DESKTOP_APPROVAL=PASS deny_no_file=true accept_file_verified=true provider=fixture runtime=real');
}finally{await app.close();await upstream.close();await rm(root,{recursive:true,force:true});}
