import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
const user=await mkdtemp(join(tmpdir(),'coagent-sidebar-'));
const site=createServer((_q,r)=>{r.setHeader('content-type','text/html');r.end('<h1>SIDEBAR_PAGE</h1>');});await new Promise(r=>site.listen(0,'127.0.0.1',r));
const env={...process.env,COAGENT_TEST_USER_DATA:user};delete env.DEEPSEEK_API_KEY;delete env.QWEN_API_KEY;
const app=await electron.launch({args:[resolve('dist/desktop/main.mjs')],env});
try{
 const p=await app.firstWindow();await p.waitForSelector('h1');
 const settings=p.getByRole('button',{name:'设置',exact:true});assert.equal(await settings.evaluate(e=>getComputedStyle(e).textAlign),'left');await settings.click();await p.getByRole('button',{name:'关闭设置',exact:true}).click();
 await p.getByRole('button',{name:'浏览器',exact:true}).click();await p.getByRole('button',{name:'关闭网页',exact:true}).click();await p.locator('.browser-toolbar').waitFor({state:'hidden'});
 await p.getByRole('button',{name:'新增侧栏标签'}).click();await p.getByRole('menuitem',{name:'打开浏览器'}).click();await p.locator('.browser-toolbar').waitFor();
 await p.getByLabel('允许本机 HTTP').check();await p.getByLabel('浏览器地址').fill(`http://127.0.0.1:${site.address().port}/`);await p.getByRole('button',{name:'打开',exact:true}).click();await p.waitForFunction(async()=>(await window.coagent.call('browser:state')).diagnostics.status==='loaded');
 await p.getByRole('button',{name:'新增侧栏标签'}).click();await p.waitForFunction(async()=>!(await window.coagent.call('browser:state')).visible);await p.getByRole('menuitem',{name:'工作文件',exact:true}).click();await p.getByRole('button',{name:'浏览器',exact:true}).click();
 await p.getByRole('button',{name:'收起侧栏',exact:true}).click();await p.locator('.activity').waitFor({state:'hidden'});assert.equal((await p.evaluate(()=>window.coagent.call('browser:state'))).open,true);
 await p.getByRole('button',{name:'打开右侧栏',exact:true}).click();await p.waitForFunction(async()=>(await window.coagent.call('browser:state')).visible);
 await p.screenshot({path:'.verification/sidebar-fix.png'});
 await p.getByRole('button',{name:'关闭网页',exact:true}).click();assert.equal((await p.evaluate(()=>window.coagent.call('browser:state'))).open,false);
 for(const name of ['执行动态','工作文件','变更'])await p.getByRole('button',{name:'关闭'+name,exact:true}).click();await p.locator('.activity').waitFor({state:'hidden'});
 await p.getByRole('button',{name:'打开右侧栏',exact:true}).click();await p.locator('.workspace-tab').waitFor();
 console.log('SIDEBAR_FIX=PASS plus_menu blank_close loaded_close collapse_preserves_page reopen last_tab_close settings_left');
}finally{await app.close();site.closeAllConnections();await new Promise(r=>site.close(r));await rm(user,{recursive:true,force:true});}
