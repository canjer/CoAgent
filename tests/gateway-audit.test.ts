import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startGateway} from '../packages/model-gateway/src/server.js';
import {testServer} from './helpers/http.js';
const token='gateway-audit-local-token-123456789';
async function setup(t:any,status=200,chat=false){
 const root=await mkdtemp(join(tmpdir(),'gateway-audit-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const upstream=await testServer((_,__,res)=>{res.writeHead(status,{'content-type':'text/event-stream'});res.end(chat?'data: {"choices":[{"index":0,"delta":{"content":"OUTPUT_SECRET"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n':'data: OUTPUT_SECRET\n\n');});t.after(()=>upstream.close());
 const gateway=await startGateway({token,auditDirectory:join(root,'audit'),auditContext:()=>({threadId:'thread-test',turnId:'turn-test'}),provider:{protocol:chat?'chat-completions':'responses',baseUrl:upstream.baseUrl,alias:'local',upstreamModel:'MODEL_SECRET',apiKey:'KEY_SECRET'}});t.after(()=>gateway.close());
 const request=()=>fetch(gateway.baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({model:'local',input:'PROMPT_SECRET',stream:true})});return {root,upstream,gateway,request};
}
for(const chat of [false,true])test(`gateway audit correlates ${chat?'Chat':'Responses'} without content or credentials`,async t=>{
 const f=await setup(t,200,chat);const response=await f.request();assert.equal(response.status,200);await response.text();const names=await readdir(join(f.root,'audit'));assert.equal(names.length,2);const records=await Promise.all(names.map(n=>readFile(join(f.root,'audit',n),'utf8')));assert.doesNotMatch(records.join(''),/PROMPT_SECRET|OUTPUT_SECRET|MODEL_SECRET|KEY_SECRET|Bearer/);const rows=records.map(x=>JSON.parse(x));assert.equal(rows[0].requestId,rows[1].requestId);assert.equal(rows[1].outcome,'transport-completed');assert.equal(rows[0].context.turnId,'turn-test');assert.equal((await stat(join(f.root,'audit',names[0]!))).mode&0o777,0o600);
});
test('gateway provider rejection is audited without error response body',async t=>{const f=await setup(t,402);const r=await f.request();assert.equal(r.status,402);await r.text();const name=(await readdir(join(f.root,'audit'))).find(n=>n.endsWith('.result.json'))!;const result=JSON.parse(await readFile(join(f.root,'audit',name),'utf8'));assert.equal(result.outcome,'provider-error');assert.equal(result.upstreamStatus,402);});
test('gateway blocks network when intent persistence fails',async t=>{const f=await setup(t);await writeFile(join(f.root,'audit'),'not a directory');const r=await f.request();assert.equal(r.status,502);await r.text();assert.equal(f.upstream.requests.length,0);});
test('gateway rejects unauthenticated requests without payload audit',async t=>{const f=await setup(t);const r=await fetch(f.gateway.baseUrl+'/responses');assert.equal(r.status,401);await r.text();assert.equal(f.upstream.requests.length,0);await assert.rejects(readdir(join(f.root,'audit')));});
test('gateway timeout produces correlated terminal audit',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gateway-timeout-'));t.after(()=>rm(root,{recursive:true,force:true}));const upstream=await testServer(()=>{});t.after(()=>upstream.close());const gateway=await startGateway({token,timeoutMs:100,auditDirectory:root,provider:{protocol:'responses',baseUrl:upstream.baseUrl,alias:'local',upstreamModel:'x'}});t.after(()=>gateway.close());const r=await fetch(gateway.baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer '+token},body:'{"model":"local"}'});await r.text();assert.equal(r.status,502);const files=await readdir(root);const result=JSON.parse(await readFile(join(root,files.find(n=>n.endsWith('.result.json'))!),'utf8'));assert.equal(result.outcome,'cancelled-or-timeout');
});
test('gateway client disconnect is audited after intent',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gateway-cancel-'));t.after(()=>rm(root,{recursive:true,force:true}));let ready!:()=>void;const received=new Promise<void>(r=>ready=r);const upstream=await testServer((_,__,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(': pending\n\n');ready();});t.after(()=>upstream.close());const gateway=await startGateway({token,auditDirectory:root,provider:{protocol:'responses',baseUrl:upstream.baseUrl,alias:'local',upstreamModel:'x'}});t.after(()=>gateway.close());const controller=new AbortController();const pending=fetch(gateway.baseUrl+'/responses',{method:'POST',signal:controller.signal,headers:{authorization:'Bearer '+token},body:'{"model":"local"}'}).then(r=>r.text()).catch(()=>{});await received;controller.abort();await pending;let result:any;for(let i=0;i<100;i++){const name=(await readdir(root)).find(n=>n.endsWith('.result.json'));if(name){result=JSON.parse(await readFile(join(root,name),'utf8'));break;}await new Promise(r=>setTimeout(r,10));}assert.equal(result?.outcome,'cancelled-or-timeout');
});
