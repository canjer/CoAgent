import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
const user=await mkdtemp(join(tmpdir(),'coagent-startup-'));let app;
const env={...process.env,COAGENT_TEST_USER_DATA:user};
try{
 const packaged=process.env.COAGENT_TEST_APP;
 app=await electron.launch({...packaged?{executablePath:resolve(packaged),args:[],cwd:tmpdir()}:{args:[resolve('dist/desktop/main.mjs')]},env});
 const page=await app.firstWindow();await page.waitForSelector('h1');
 const before=await page.evaluate(()=>window.coagent.call('state'));
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.hide();});
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 const binary=await app.evaluate(()=>process.execPath);
 await new Promise((resolveDone,reject)=>{const child=spawn(binary,packaged?[]:[resolve('dist/desktop/main.mjs')],{env,stdio:'ignore'});const timer=setTimeout(()=>{child.kill();reject(new Error('Second instance did not exit'));},15000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);code===0?resolveDone():reject(new Error('Unexpected second-instance exit '+code));});});
 let visible=false;for(let n=0;n<50;n++){visible=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible());if(visible)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(visible,true);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
 assert.equal((await page.evaluate(()=>window.coagent.call('state'))).hostPid,before.hostPid);
 await app.evaluate(({BrowserWindow,app})=>{BrowserWindow.getAllWindows()[0].hide();app.emit('activate');});assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
 console.log('STARTUP=PASS second_instance_reveals_existing_window=true one_window=true host_unchanged=true activate_restores=true');
}finally{await app?.close();await rm(user,{recursive:true,force:true});}
