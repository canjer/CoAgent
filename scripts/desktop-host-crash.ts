import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {mkdtemp,mkdir,writeFile,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {testServer} from '../tests/helpers/http.js';
const root=await mkdtemp(join(tmpdir(),'coagent-host-crash-')),workspace=join(root,'workspace'),user=join(root,'user');
await mkdir(workspace);await mkdir(user);await writeFile(join(user,'settings.json'),JSON.stringify({workspace}));
let requests=0;let observed!:()=>void;const incoming=new Promise<void>(r=>{observed=r;});
const upstream=await testServer((_body,req,res)=>{
 if(req.url!='/v1/responses'){res.writeHead(404);res.end();return;}
 requests++;res.writeHead(200,{'content-type':'text/event-stream'});res.write(': wait\n\n');observed();
});
const env:Record<string,string>={...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined)),DEEPSEEK_API_KEY:'fixture-not-real',COAGENT_TEST_BASE_URL:upstream.baseUrl,COAGENT_TEST_USER_DATA:user};delete env.COAGENT_MODEL;
let app=await electron.launch({args:[resolve('dist/desktop/main.mjs')],env});
try{
 let page=await app.firstWindow();await page.waitForSelector('h1');
 const state=await page.evaluate(()=> (window as any).coagent.call('state'));
 assert.notEqual(state.hostPid,app.process().pid);
 await page.getByLabel('任务描述').fill('Wait for the fixture response.');await page.getByRole('button',{name:'开始任务 ↑'}).click();
 await Promise.race([incoming,new Promise((_,reject)=>setTimeout(()=>reject(new Error('fixture request timeout')),15000))]);
 const auditDirectory=join(user,'audit','model-gateway');const intents=(await readdir(auditDirectory)).filter(n=>n.endsWith('.intent.json'));assert.equal(intents.length,1);const auditIntent=await readFile(join(auditDirectory,intents[0]!), 'utf8');assert.doesNotMatch(auditIntent,/fixture-not-real|Wait for the fixture response/);assert.equal(JSON.parse(auditIntent).phase,'intent');
 const lines=execFileSync('/bin/ps',['-Ao','pid,ppid,command'],{encoding:'utf8'}).split('\n');
 const child=lines.map(l=>l.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).find(m=>m&&Number(m[2])===state.hostPid&&m[3]?.includes('app-server'));
 assert.ok(child,'Codex must be a child of Host');const runtimePid=Number(child[1]);
 process.kill(state.hostPid,'SIGKILL');
 await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/任务不会自动重放/);await page.getByRole('button',{name:'开始任务 ↑'}).waitFor();
 const recovered=await page.evaluate(()=> (window as any).coagent.call('state'));
 assert.notEqual(recovered.hostPid,state.hostPid);assert.equal(recovered.workspace,workspace);
 await page.evaluate(()=> (window as any).coagent.call('list'));
 await assert.rejects(page.evaluate(()=> (window as any).coagent.call('approve',{id:999,decision:'accept'})),/审批已过期/);
 let gone=false;for(let i=0;i<30;i++){try{process.kill(runtimePid,0);}catch{gone=true;break;}await new Promise(r=>setTimeout(r,100));}
 assert.equal(gone,true,'orphan Codex child must be reaped');assert.equal(requests,1,'no task replay');
 assert.equal(recovered.recovery.status,'needs-review');
 await assert.rejects(page.evaluate(()=> (window as any).coagent.call('run',{prompt:'Must not replay'})),/待核对/);
 await app.close();
 app=await electron.launch({args:[resolve('dist/desktop/main.mjs')],env});page=await app.firstWindow();
 await page.getByRole('button',{name:'已核对，解除阻塞'}).waitFor();
 const persisted=await page.evaluate(()=> (window as any).coagent.call('state'));
 assert.equal(persisted.recovery.id,recovered.recovery.id);assert.equal(persisted.recovery.status,'needs-review');
 await page.getByRole('button',{name:'查看任务历史'}).click();
 await page.screenshot({path:'.verification/host-crash.png'});
 await page.getByRole('button',{name:'已核对，解除阻塞'}).click();
 await page.waitForFunction(async()=> (await (window as any).coagent.call('state')).recovery.status==='reviewed');
 assert.equal(requests,1);
 assert.equal(await readFile(join(auditDirectory,intents[0]!), 'utf8'),auditIntent);console.log('GATEWAY_AUDIT_HOST=PASS intent_before_send no_credentials no_prompt restart_retained no_replay');
 console.log('DURABLE_RECOVERY=PASS application_restart=true blocked_run=true explicit_ack=true replay_count=0');
 console.log('HOST_CRASH=PASS separate_pid=true runtime_child_cleaned=true UI_alive=true reconnect=true stale_approval_rejected=true replay_count=0');
}finally{await app.close();await upstream.close();await rm(root,{recursive:true,force:true});}
