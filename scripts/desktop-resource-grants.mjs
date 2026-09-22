import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
let hits=0;const resource=createServer((_q,r)=>{hits++;r.setHeader('content-type','image/svg+xml');r.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>');});await new Promise(r=>resource.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${resource.address().port}`;
const site=createServer((_q,r)=>{r.setHeader('content-type','text/html');r.end(`<h1>Resource approval fixture</h1><img src="${origin}/pixel?secret=do-not-log">`);});await new Promise(r=>site.listen(0,'127.0.0.1',r));
const user=await mkdtemp(join(tmpdir(),'coagent-grants-ui-'));const env={...process.env,COAGENT_TEST_USER_DATA:user};delete env.DEEPSEEK_API_KEY;delete env.QWEN_API_KEY;
const app=await electron.launch({args:[resolve('dist/desktop/main.mjs')],env});
try{
 const p=await app.firstWindow();await p.waitForSelector('h1');await p.getByRole('button',{name:'浏览器',exact:true}).click();
 await p.getByLabel('允许本机 HTTP').check();await p.getByLabel('浏览器地址').fill(`http://127.0.0.1:${site.address().port}/`);await p.getByRole('button',{name:'打开',exact:true}).click();
 await p.waitForFunction(async()=>((await window.coagent.call('browser:state')).diagnostics.blocked.length)>0);assert.equal(hits,0);
 await p.locator('.browser-diagnostics summary').click();assert.doesNotMatch(await p.locator('.browser-diagnostics').innerText(),/do-not-log/);
 await p.getByRole('button',{name:'授权此资源类型',exact:true}).click();await p.waitForFunction(async()=>!(await window.coagent.call('browser:state')).visible);
 await p.getByRole('button',{name:'确认资源变更',exact:true}).click();await p.getByRole('button',{name:'撤销授权',exact:true}).waitFor();assert.equal(hits,0);
 await p.getByRole('button',{name:'刷新',exact:true}).click();await p.waitForFunction(async()=>(await window.coagent.call('browser:state')).diagnostics.status==='loaded');for(let i=0;i<100&&hits===0;i++)await new Promise(r=>setTimeout(r,20));assert.ok(hits>0);const prior=hits;
 await p.getByRole('button',{name:'撤销授权',exact:true}).click();await p.getByRole('button',{name:'确认资源变更',exact:true}).click();await p.getByRole('button',{name:'撤销授权',exact:true}).waitFor({state:'hidden'});
 await p.getByRole('button',{name:'刷新',exact:true}).click();await p.waitForFunction(async()=>(await window.coagent.call('browser:state')).diagnostics.totalBlocked>0);assert.equal(hits,prior);
 await p.getByRole('button',{name:'关闭网页',exact:true}).click();assert.deepEqual((await p.evaluate(()=>window.coagent.call('browser:state'))).resourceGrants,[]);
 console.log('RESOURCE_GRANT_UI=PASS initial_block confirmation hidden_view no_auto_reload allowed_image revoke reblock redacted close_clear');
}finally{await app.close();for(const s of [site,resource]){s.closeAllConnections();await new Promise(r=>s.close(r));}await rm(user,{recursive:true,force:true});}
