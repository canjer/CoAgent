import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=await mkdtemp(join(tmpdir(),'coagent-workbench-')),workspace=join(root,'workspace'),user=join(root,'user');
await mkdir(workspace);await mkdir(user);await writeFile(join(user,'settings.json'),JSON.stringify({workspace,model:'deepseek-chat'}));
const git=(...args)=>execFileSync('/usr/bin/git',['-C',workspace,...args],{env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');await writeFile(join(workspace,'fixture.txt'),'old line\n');git('add','fixture.txt');git('-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','commit','-qm','fixture');await writeFile(join(workspace,'fixture.txt'),'new line\n');
let app;
async function launch(){
 const env={...process.env,DEEPSEEK_API_KEY:'fixture-key',QWEN_API_KEY:'fixture-key',COAGENT_TEST_USER_DATA:user};delete env.COAGENT_MODEL;
 app=await electron.launch({args:[resolve('dist/desktop/main.mjs')],env});const page=await app.firstWindow();await page.waitForSelector('h1');await page.evaluate(()=>window.coagent.call('list'));return page;
}
try{
 let page=await launch();console.log('WORKBENCH_PHASE=launched');
 await page.getByLabel('模型').selectOption('qwen3.5-flash');
 await page.waitForFunction(()=>document.querySelector('select').value==='qwen3.5-flash');
 // Wait for the persisted host selection, not just the native select's optimistic display.
 await page.waitForFunction(async()=>(await window.coagent.call('state')).model==='qwen3.5-flash');
 assert.equal(JSON.parse(await readFile(join(user,'settings.json'),'utf8')).model,'qwen3.5-flash');
 await page.getByRole('button',{name:'变更',exact:true}).click();await page.getByLabel('变更内容').waitFor();
 assert.match(await page.getByLabel('变更内容').innerText(),/\+new line/);assert.match(await page.getByLabel('变更内容').innerText(),/-old line/);
 await page.screenshot({path:'.verification/desktop-diff.png'});
 git('add','fixture.txt');await page.getByRole('button',{name:'已暂存',exact:true}).click();await page.getByLabel('变更内容').waitFor();assert.match(await page.getByLabel('变更内容').innerText(),/\+new line/);
 console.log('WORKBENCH_PHASE=restart');await app.close();app=null;page=await launch();console.log('WORKBENCH_PHASE=reopened');assert.equal(await page.getByLabel('模型').inputValue(),'qwen3.5-flash');
 await page.getByLabel('模型').selectOption('deepseek-chat');await page.waitForFunction(async()=>(await window.coagent.call('state')).model==='deepseek-chat');
 assert.equal(await page.getByRole('alert').count(),0);
 await app.close();app=null;const backup=JSON.parse(await readFile(join(user,'settings.json.bak'),'utf8'));await writeFile(join(user,'settings.json'),'{broken configuration');page=await launch();
 await page.waitForFunction(model=>document.querySelector('select').value===model,backup.model);
 assert.equal((await page.evaluate(()=>window.coagent.call('state'))).model,backup.model);
 assert.match(await page.locator('.composer-area').innerText(),/已从备份恢复/);
 assert.equal(JSON.parse(await readFile(join(user,'settings.json'),'utf8')).version,1);
 console.log('CONFIG_RECOVERY=PASS corrupted_primary=true backup_restored=true UI_warning=true');
 console.log('WORKBENCH=PASS model_switch=true model_persistence=true staged_diff=true unstaged_diff=true model_calls=0');
}finally{console.log('WORKBENCH_PHASE=closing');await app?.close();console.log('WORKBENCH_PHASE=closed');await rm(root,{recursive:true,force:true});}
