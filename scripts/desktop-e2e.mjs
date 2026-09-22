import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const expectedModel=process.env.COAGENT_MODEL||'deepseek-chat';
const root=await mkdtemp(join(tmpdir(),'coagent-desktop-e2e-'));
const workspace=join(root,'workspace'),userData=join(root,'user');
await mkdir(workspace);await mkdir(userData);await writeFile(join(userData,'settings.json'),JSON.stringify({workspace}));
let app;
async function launch(){
 app=await electron.launch({...process.env.COAGENT_TEST_APP?{executablePath:resolve(process.env.COAGENT_TEST_APP),args:[],cwd:tmpdir()}:{args:[resolve('dist/desktop/main.mjs')]},env:{...process.env,COAGENT_TEST_USER_DATA:userData}});
 const page=await app.firstWindow();await page.waitForSelector('h1',{timeout:process.env.COAGENT_TEST_APP?60000:30000});return page;
}
try{
 let page=await launch();
 assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
 if(process.env.COAGENT_CAPTURE_SCREENSHOTS==='1')await page.screenshot({animations:'disabled',timeout:15000,path:'.verification/desktop-welcome.png'});
 await page.getByRole('textbox',{name:'任务描述'}).fill('Create desktop-proof.txt containing exactly DESKTOP_OK followed by a newline. Verify it with a shell command. Do not change other files.');
 await page.getByRole('button',{name:'开始任务 ↑'}).click();
 await page.getByRole('button',{name:'■ 停止'}).waitFor();
 await page.getByRole('button',{name:'开始任务 ↑'}).waitFor({timeout:120000});
 assert.equal(await page.getByRole('alert').count(),0,await page.locator('.composer-area').innerText());
 assert.equal(await readFile(join(workspace,'desktop-proof.txt'),'utf8'),'DESKTOP_OK\n');console.log('DESKTOP_PHASE=file_verified');
 assert.equal(await page.getByRole('alert').count(),0);
 if(process.env.COAGENT_CAPTURE_SCREENSHOTS==='1')await page.screenshot({animations:'disabled',timeout:15000,path:'.verification/desktop-task.png'});
 assert.equal(await page.evaluate(async()=>(await window.coagent.call('state')).model),expectedModel);
 await page.getByRole('button',{name:'工作文件',exact:true}).click();
 await page.getByRole('button',{name:'▤ desktop-proof.txt',exact:true}).click();
 await page.getByLabel('文件内容').waitFor();
 assert.equal(await page.getByLabel('文件内容').innerText(),'DESKTOP_OK\n');
 if(process.env.COAGENT_CAPTURE_SCREENSHOTS==='1')await page.screenshot({animations:'disabled',timeout:15000,path:'.verification/desktop-files.png'});
 await app.close();app=null;
 page=await launch();console.log('DESKTOP_PHASE=restarted');
 await page.locator('nav button').first().waitFor({timeout:20000});
 await page.locator('nav button').first().click();
 await page.locator('article').first().waitFor();
 assert.match(await page.locator('.conversation').innerText(),/DESKTOP_OK/);
 await page.evaluate(()=>{window.__terminal=[];window.coagent.subscribe(e=>{if(e.method==='turn/completed')window.__terminal.push(e.params.turn.status);});});
 await page.getByRole('textbox',{name:'任务描述'}).fill('Run sleep 30 in shell, then say finished.');
 await page.getByRole('button',{name:'开始任务 ↑'}).click();
 await page.getByRole('button',{name:'■ 停止'}).click();
 await page.getByRole('button',{name:'开始任务 ↑'}).waitFor({timeout:20000});
 assert.equal(await page.getByRole('alert').count(),0,await page.locator('.composer-area').innerText());
 await page.waitForFunction(()=>window.__terminal.length>0,{},{timeout:10000});
 assert.deepEqual(await page.evaluate(()=>window.__terminal),['interrupted']);
 console.log(`DESKTOP_E2E=PASS isolated_renderer=true real_file_task=true restart_history=true cancellation=true file_preview=true configured_model=${expectedModel} packaged=${!!process.env.COAGENT_TEST_APP} screenshots=${process.env.COAGENT_CAPTURE_SCREENSHOTS==='1'}`);
}finally{await app?.close();await rm(root,{recursive:true,force:true});}
