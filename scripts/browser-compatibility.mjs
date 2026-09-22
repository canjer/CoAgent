import {app,BrowserWindow} from 'electron';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {BrowserService} from '../apps/desktop/browser-service.mjs';
const user=await mkdtemp(join(tmpdir(),'coagent-compat-'));app.setPath('userData',user);app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,width:1000,height:800});const browser=new BrowserService(window,()=>{});const results=[];let code=0;
 browser.setLayout({visible:true,x:0,y:0,width:1000,height:800});
 try{
  for(const url of ['https://example.com/','https://www.electronjs.org/docs/latest/api/web-contents-view','https://developer.mozilla.org/en-US/docs/Web/JavaScript']){
   let read={};const start=Date.now();
   try{await browser.manual('browser_navigate',{url});const snapshot=await browser.manual('browser_snapshot');read={snapshot:'pass',title:snapshot.title,textLength:snapshot.text.length,elementCount:snapshot.elements.length};}
   catch{read={snapshot:'not-completed'};}
   const diagnostic=browser.state().diagnostics;results.push({url,...read,durationMs:Date.now()-start,...diagnostic});
   console.log(JSON.stringify(results.at(-1)));await browser.closePage();
  }
  await mkdir('.verification',{recursive:true});await writeFile(resolve('.verification/browser-compatibility.json'),JSON.stringify({checkedAt:new Date().toISOString(),mode:'read-only public pages; no model calls; no clicks; existing network rules unchanged',results},null,2)+'\n');
  console.log('COMPATIBILITY_REPORT=COMPLETE sites='+results.length+' snapshots='+results.filter(r=>r.snapshot==='pass').length);
 }catch(error){console.error(error);code=1;}finally{await browser.close();window.destroy();await rm(user,{recursive:true,force:true});app.exit(code);}
});
