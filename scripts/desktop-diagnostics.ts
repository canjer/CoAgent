import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {testServer} from '../tests/helpers/http.js';
import type {Obj} from '../packages/model-gateway/src/chat-adapter.js';
const user=await mkdtemp(join(tmpdir(),'coagent-diagnostic-ui-'));let requests=0;
const server=await testServer((body,req,res)=>{
 assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,'Bearer fixture-diagnostic-key');
 const n=requests++;let delta:Obj,finish='stop';
 if(n===0)delta={content:'DIAGNOSTIC_OK'};
 else if(n===1){delta={tool_calls:[{index:0,id:'diag_call',function:{name:'diagnostic_echo',arguments:'{"value":"probe"}'}}]};finish='tool_calls';}
 else delta={content:(body.messages as Obj[]).find(m=>m.role==='tool')!.content};
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\ndata: [DONE]\n\n`);
});
const env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>typeof e[1]==='string'));env.COAGENT_TEST_USER_DATA=user;
const app=await electron.launch({args:[resolve('dist/desktop/main.mjs')],env});
try{const page=await app.firstWindow();await page.waitForSelector('h1');
 const status=await page.evaluate(baseUrl=>(window as any).coagent.call('providers:save',{label:'Chat Diagnostic',baseUrl,protocol:'chat-completions',upstreamModel:'fixture'}),server.baseUrl);
 const id=status.models.find((m:any)=>m.custom).id;await page.evaluate(id=>(window as any).coagent.call('credentials:save',{id,key:'fixture-diagnostic-key'}),id);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'诊断 Chat Diagnostic',exact:true}).click();
 const result=page.getByLabel('诊断结果 '+id);await result.waitFor({timeout:20000});assert.equal((await result.innerText()).split('：通过').length-1,3);assert.equal(requests,3);assert.match(await result.innerText(),/不保证完整任务能力/);
 console.log('DIAGNOSTIC_UI=PASS checks=3 protocol=chat-completions commands_executed=0 real_provider=false');
}finally{await app.close();await server.close();await rm(user,{recursive:true,force:true});}
